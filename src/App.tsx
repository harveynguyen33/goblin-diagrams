import {useCallback, useEffect, useMemo, useState, useRef} from 'react';
import {createPortal} from 'react-dom';
import {
  ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState,
  MarkerType, useStore, reconnectEdge, PanOnScrollMode, ConnectionMode,
  type Connection, type Node, type Edge, type NodeChange, type EdgeChange,
  type ReactFlowInstance, type XYPosition,
} from '@xyflow/react';
import {
  Copy, ChevronDown, ChevronLeft, ChevronRight, Trash2,
  LayoutGrid, Plus, Pencil, Save,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
  BringToFront, SendToBack,
  LayoutTemplate,
  X,
} from 'lucide-react';
import '@xyflow/react/dist/style.css';
import {
  // ROUND T — the bend rules (`SIDE_OUT`, `OPPOSITE_SIDE`, `STEP_GAP_PX`,
  // `isSide4`) and the drag's own maths live in `edgeBend.ts`: the geometry a
  // handler needs, the axis rule the POINTER decides (`dragAxis`) and the
  // kind-aware wrapper (`bendAxisFor`), the writer (`applyDrag`) and the base
  // point (`drawnMid`). The renderer's route is our own path on a stored
  // waypoint and the generator otherwise (`needsCustom`).
  // ROUND U — `bendAxisFor`/`dragPoint` are the ONE decision point shared with
  // `GoblinEdge`: on `bezier`/`straight` the axis is `'free'`, both coordinates
  // are written, and no axis is projected.
  applyDrag, bendAxisFor, dragPoint, plainMidpoint, BEND_SNAP_PX, type BendPhase, type Pt,
} from './edgeBend';
/* ROUND AK, PASS 2 — the label's own rules. `reverseEdgePatch` is AK-15's
   mirror; `labelBgOf` is AK-12's tolerant reader (an unknown value resolves to
   the shipped `surface`, never to an unstyled plate); `LabelWrite` is the shape
   AK-10's drag writer carries. (`labelWrite` itself is applied by `GoblinEdge`,
   the only side holding the resolved path, the anchor and the measured label
   box — see `useEdgeGesture`'s sibling note.) */
import {LABEL_BG_VALUES, labelBgOf, reverseEdgePatch, type LabelWrite} from './edgeLabel';

import DiagramNode, {type NodeKind} from './nodes/DiagramNode';
import LabelNode, {type LabelKind} from './nodes/LabelNode';
import {newResizeGuard, recordResizeGesture} from './resizeHistory';
import {useRotation} from './useRotation';
import {ROTATE_SNAP_DEG} from './layoutConstants';
import {GroupRotateGrip} from './components/GroupRotateGrip';
import {SelectionBox} from './components/SelectionBox';
/* GOBI-S1 — the share view: hook (route + decode + edit-copy) and chrome.
 * BoardsPopover is the GOBI-S1 extraction that PAID for this round's App
 * lines (the hard cap may never grow). */
import {useShareView, shareViewPayload} from './useShareView';
import {ShareBanner} from './components/ShareBanner';
import BoardsPopover from './components/BoardsPopover';
import TableNode, {type TableColumn, type ShowMode} from './nodes/TableNode';
import {edgeTypes} from './edges';
import IconPicker from './IconPicker';
import SearchPalette from './SearchPalette';
import Tooltip from './Tooltip';
import {COLOR_KEYS, COLOR_VAR, isColorKey, type ColorKey, resolveColor, resolveColorKey} from './colors';
import {SHAPES, asShape, ShapePreview, type Shape} from './nodes/shapes';
/* ROUND BJ (bundle split) — the EXPORT PIPELINE is now a lazy chunk. The
 * editing surface (canvas render) never needs the emitter at first paint:
 * exportSvg/exportScene/textOutline/textOutlineHb/exportPng/fontFiles/
 * printView are only reachable from user actions (Export modal build,
 * Copy PNG, print PDF). So App keeps only the TYPES statically (import
 * type — erased at build time) and pulls the values through ONE dynamic
 * import seam at the point of use. First export pays one chunk fetch
 * (~150-200 KB raw, ~40 KB gz) that used to sit in the boot bundle.
 * The whole cluster is closed over App.tsx (no other app module imports
 * these by value), so the seam here is the only door. */
/* ROUND BJ — same lazy seam as exportSvg above: the shaper stack and the
 * print route only run inside export handlers. One memoised promise per
 * module, so the first export pays the chunk once and every later export
 * reuses it. Types stay static (erased). */

import {
  getInspectorSections, hasBody, hasIcon, hasKicker, hasMetric, hasSub, type InspectorTarget, type SectionId,
} from './inspector';
import {
  IconPickerRow, ShapesPicker, Stepper, ToggleRow, Section, RotationRow,
  /* ROUND AM, AM-4/AM-5 — the flow speed's slider and its live rail, plus the
     two pure helpers the harness executes rather than restates. */
  FlowSpeed,
  ArtArrow, ArtCardinality, ArtCurve, ArtDash, ArtFlow, ArtWidth,
  type PickerOption,
} from './InspectorPickers';
/* PACKAGE-P §E — the Text section's data half. ONE import covers both targets:
   the model is target-agnostic, and the two `*ForBody` helpers supply the only
   things that differ between them: a label-only node is centred by design on
   BOTH axes (a card is left and starts at its padding-top). ROUND Z FIX 2 added
   the vertical one — the defect it fixes was a single global `middle` that no
   card ever painted. */
import {
  TEXT_SIZE_OPTS, TEXT_WEIGHT_OPTS, TEXT_ALIGN_OPTS, TEXT_FONT_OPTS, TEXT_FONT_FAMILY,
  TEXT_VALIGN_OPTS,
  alignForBody, vAlignForBody, mergeTextStyle, readTextStyle,
  type TextStyle, type TextSize, type TextWeight, type TextAlign, type TextFont,
  type TextVAlign,
} from './textStyle';
import {
  getPreset, edgeColorPatch, edgeColorLiteralPatch, C4, isC4Type, LIBRARY, DEFAULT_PRESET_ID,
  type PresetId, type DiagramPreset, type PathId,
} from './presets';
import {type PaletteItem} from './palette';
/* ROUND AD, ITEM 5(a) — the colour key's label and its persisted dismissal
   (Option B's condition: the key must be labelled where the user looks, and the
   label must be dismissible so it does not become permanent furniture). */
import {KEY_NOTE_TEXT, loadKeyNote, saveKeyNote} from './colorKeyNote';
import {applyTheme, loadMode, hasStoredMode, resolveMode, isDarkTheme, saveMode, type Mode, type ThemeName} from './theme';
import * as boards from './boards';
import type {BoardDoc, BoardMeta} from './boards';
import ContextMenu, {type CtxTarget, type CtxAction} from './ContextMenu';
import Tour from './dialogs/Tour';
import {HelpSheet} from './components/HelpSheet';
import {RotateInternalsBridge} from './components/RotateInternalsBridge';
import {ModalMounts} from './components/ModalMounts';
import {CanvasEmptyPanel} from './components/CanvasEmptyPanel';
import {Toolbar} from './components/Toolbar';
import Checklist, {type ChecklistTaskId} from './nodes/Checklist';
/* ROUND BI, ITEM 3 — the feedback dialog mounts ONCE, at this level: the ?
   help sheet and Settings → About are two entry points into the same form
   (one open-state, one focus-restore target per opener). */
import {computeHelperSnap, type HelperGuides} from './helperLines';
import HelperLinesView from './HelperLinesView';
/* ROUND AM, AM-3 — the flow glyphs' ONE home. Imported HERE and in
   `GoblinEdge.tsx` (AL-6: the chip row and the travelling chip read the same
   map). No React Flow, so the panel reads it without pulling the canvas in. */
import {FLOW_ICON_PATHS} from './nodes/flowIcons';
import {CrowFootDefs, cardinalityLabel, isCrowFoot} from './nodes/Crowfoot';
import {
  useHoverChoreography, useInteractionGuard, useLayoutTransition, useAnimationGating,
  useHoverHighlight, NO_ANIM, READ_ONLY, NO_PAN,
} from './choreography';
import {useEditorInterface} from './useEditorInterface';
import {
  useLongPress,
  COARSE_DRAG_THRESHOLD_PX,
  FINE_DRAG_THRESHOLD_PX,
  FINE_CONNECTION_DRAG_THRESHOLD_PX,
  FINE_NODE_CLICK_DISTANCE_PX,
  COARSE_NODE_CLICK_DISTANCE_PX,
} from './touch';
import {usePanelCollapse, isPanelHidden} from './panelCollapse';
/* ROUND AA, ITEM 2 — the marquee mode: its persisted value, its React Flow
   enum, and the hook that owns both. */
import {useMarqueeMode} from './marqueeMode';
import {useZOrderMode} from './zOrderMode';
import {useLayoutDir} from './layoutMode';
import {useInspectorSections} from './inspectorState';
import {searchLibrary, groupByCategory} from './paletteSearch';
import {
  useCategoryCollapse, CATEGORY_ORDER, CATEGORY_LABEL, defaultOpenCategory,
} from './categoryState';
/** PACKAGE-N pass 3 — the USER library client (§6 favourites / §7 store). NOT
 *  the shape `LIBRARY` above: that one is the 34-element constant, this one is
 *  the user's own starred document on disk. */
import {type FavouriteNode} from './library';
import {loadPref, savePref} from './prefs';
import * as library from './library';
/** PACKAGE-N pass 4b — the custom-shape NODE KIND (§8.1–§8.3). The shape
 *  pipeline lives in `./customShape`; this is only the canvas node + the
 *  library plumbing. `Shape` stays at 19 — `customshape` is a node type. */
import CustomShapeNode from './nodes/CustomShapeNode';
import {parseCustomShapeEntry, newCustomShape, svgDataUri, SHAPE_MAX_INPUT_BYTES, type CustomShape} from './nodes/customShape';
/* ROUND BN, ITEM 2 — the module-level helpers now live in focused modules;
   moved verbatim, imports only. Size budgets: checks/file-size-gate.mjs. */
import {
  SHAPE_REJECT_MESSAGE, PATH_TYPES, isGoblinEdge, RECONNECT_RADIUS,
  type PathType,
} from './boardConstants';
import {migrateEdge, migrateDoc} from './boardMigrations';
import {useUndoHistory, type Snap} from './useUndoHistory';
import {usePersistence} from './usePersistence';
import {useConnections} from './useConnections';
import {useExportActions} from './useExportActions';
import {useCanvasTools} from './useCanvasTools';
import {useBoardsMenu} from './useBoardsMenu';
import {
  edgeMarkerUrl, edgeStrokeKeyOf, hasCrow, isEditable, nodeW, nodeH,
  edgeGeo, edgeDrawnMid, TableGlyph, dashArray, favouritePreview, markerFor,
  edgeStroke, edgeStrokeKey, bootTheme,
} from './boardUtils';

const nodeTypes = {goblin: DiagramNode, label: LabelNode, table: TableNode, customshape: CustomShapeNode};
let idc = 100;


/** Per-edge extras that are not part of React Flow's Edge type. */
export type EdgeData = {
  shape?: string;
  offset?: 'center' | 'start' | 'end';
  /** STEP 1 (2026-09-18): the fraction `getSmoothStepPath` calls `stepPosition`
   *  (0..1), which slides the step's cross-bar along the split axis. READ-ONLY
   *  LEGACY as of ROUND T — the slider that wrote it is gone, so nothing here
   *  writes the key any more; it is read only so a board saved while the slider
   *  existed still renders exactly as it did. */
  bend?: number;
  /** ROUND S/T (2026-09-18): the ABSOLUTE 2-D waypoint the edge's midpoint was
   *  dragged to — `bendX` from a horizontal gesture, `bendY` from a vertical one
   *  (see `edgeBend.dragAxis`). BOTH are read: a stored key routes the edge
   *  through `freePath`, which is the only route that can use both coordinates.
   *  Absent means "never dragged", and the edge stays on the generator. */
  bendX?: number;
  bendY?: number;
  /** ROUND AK, AK-10 — the FREE 2-D label position, in RELATIVE flow px, added
   *  to the anchor `GoblinEdge` derives. ABSENT (not `{0,0}`) is the default: a
   *  board that never moved its label carries no key, and `onLabelWrite` below
   *  DELETES both keys when the label is centred, so "reset", "snapped back" and
   *  "never moved" are one stored state rather than three that merely render the
   *  same. */
  labelOffset?: {x: number; y: number};
  /** ROUND AK, AK-10 — Sirius Web's `movedByUser`. While falsy the label
   *  auto-centres; once true `labelOffset` wins. */
  labelPinned?: boolean;
  /** ROUND AM, AM-1 — THE POINT the stored `labelOffset` was measured against,
   *  in flow coordinates. It is what makes a dragged label keep tracking the
   *  pointer while a NODE moves: when a write states a different anchor than the
   *  one stored here, `onLabelWrite` first corrects the stored offset by the
   *  anchor's movement and then applies the write. ABSENT is the normal state —
   *  a board written before this round, and a centred label, carry no key — and
   *  an absent anchor simply means "nothing to rebase against", so an existing
   *  board renders byte-identically and the first drag adopts the live anchor as
   *  its base. */
  labelAnchor?: {x: number; y: number};
  /** ROUND AK, AK-12 — the label plate: THREE STORED STATES, where `None` is a
   *  genuine value rather than the absence of one. Rendered as a class on
   *  `.edge-label` by the renderer; absent resolves to `surface` (today's look). */
  labelBg?: 'none' | 'surface' | 'outline';
  /** ROUND AM, AM-2 — the LABEL'S TEXT STYLE: the same `TextStyle` a node
   *  stores on `data.textStyle`, under the edge's own key. ABSENT is the state
   *  every existing board is in — `edgeTextStyleVars` returns `{}`, no custom
   *  property reaches the element and `.edge-label`'s own fallbacks paint the
   *  11px / 600 / `var(--mono)` it painted before this round.
   *
   *  WHY A SEPARATE KEY AND NOT `textStyle`. `data.textStyle` on an edge would
   *  read as the text of something that is not a node, and an edge is the only
   *  target where a stored `TextStyle` can carry fields the target cannot
   *  express (align / vAlign / colorKey — see `edgeTextStyleVars`). The label's
   *  ink stays `labelTextKey` above, so this key never becomes a second writer
   *  for the colour. */
  labelStyle?: TextStyle;
  /** ROUND AK, AK-13 — the double-click-on-the-path signal, threaded per-edge
   *  exactly like `__edit`: a fresh timestamp AND the flow point the click
   *  landed on. A double-click on a line with no label has nothing to edit yet,
   *  so the editor has to be opened by a signal (the element does not exist) and
   *  the commit has to know where the label was created.
   *
   *  ROUND AN, AN-1 — IT IS A ONE-SHOT AND IT MUST NEVER SURVIVE ITS MOMENT.
   *  It was written by `openLabelAt` and deleted NOWHERE, so it stayed on the
   *  edge forever: every later rename re-entered the renderer's create branch
   *  and wrote the CENTRED state (the owner's "đổi text, enter thì nó tự nhiên
   *  về lại center"). Two halves fix it, and they are not alternatives —
   *  `consumeEditAt` below ends the signal on both editor exits, and
   *  `migrateEdge` FOLDS A STORED ONE AWAY ON READ, because this key reached
   *  the saved document before the fix existed (measured: 4 + 2 + 1 occurrences
   *  across three of the user's own boards), so without the read-time fold a
   *  reload would put every label back in the create state. */
  __editAt?: {at: Pt; t: number};
  /** ROUND AK, AK-10 — the label drag's writer, threaded per-edge exactly like
   *  `__onBend`. It carries the FINISHED write, not the pointer: only the
   *  renderer holds the resolved path and the anchor, so the write is computed
   *  there (since ROUND AM's AM-1 by `anchorWrite` — a DELTA plus the anchor
   *  frame it was measured in) and this merges the result — rebasing the stored
   *  offset when the frame moved. */
  __onLabelWrite?: (id: string, w: LabelWrite, phase: BendPhase) => void;
  /** PACKAGE-SEQ — the UML message kind this edge carries. Drives arrowhead +
   *  dash at render (GoblinEdge) and the Mermaid arrow token at export.
   *  Absent = a normal (non-sequence) edge. */
  seqMsg?: 'sync' | 'async' | 'return' | 'self';
};


export default function App() {
  /* ITEM 2 — the canvas holds NOTHING while a board load is in flight.
     A board is the source of truth and it arrives asynchronously (~500ms after
     mount). Seeding the canvas with `initialNodes` painted the three sample
     nodes and then replaced them mid-flight — the placeholder flash. The seed's
     ONLY remaining consumer is the genuine first run, where the bootstrap below
     saves it verbatim as "My first board"; until the load resolves (or fails)
     the canvas is deliberately empty and shows the `.canvas-empty` panel, which
     is already gated on `nodes.length === 0`. `boardLoaded` is what keeps that
     panel from claiming "This board is empty" during the load. */
  const [boardLoaded, setBoardLoaded] = useState(false);
  /* AS-5 — the save gate's LOADED-ID half: the id of the document the loader
     actually applied, set by applyBoard (and ONLY applyBoard — every path that
     arrives here went through a successful load), cleared when the canvas
     returns to no-board. A save runs only when this EQUALS the in-memory doc's
     id: a flush landing while the NEXT board is still loading, a debounce
     firing mid-load, or a failed load can never write another board's file. */
  const [boardLoadedDocId, setBoardLoadedDocId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [selCount, setSelCount] = useState(0);
  const [selEdgeId, setSelEdgeId] = useState<string | null>(null);
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // ---- M3/S1: interface class + M3/S2: docked-panel collapse ----
  // `appRef` is the EMBED HOST, not the window: the hook measures this element
  // with a ResizeObserver so a narrow host (side pane, iframe, split column)
  // gets the compact layout even on a wide screen. Its results are published on
  // `.app` as data attributes for the later touch / tablet / phone steps.
  const appRef = useRef<HTMLDivElement>(null);
  const ui = useEditorInterface(appRef);
  // M3/S2c: `setPanelsVisible` is the shortcut's ONE atomic write; `togglePanel`
  // is the per-side chevron's. M3/S2d dropped `setPanelPinned` with the auto-hide
  // it served, and the reviewer's flag removed the two never-consumed methods
  // (`setPanelCollapsed`, `resetPanels`) — one flag per side is the whole state.
  const {state: panelState, togglePanel, setPanelsVisible} = usePanelCollapse();

  /* ---- PACKAGE-P PASS 3 §C: ONE fold state for the whole panel ----------
     Loaded once from `diagram-studio:inspector-sections`, saved on every change.
     The state is keyed by SECTION ID and is global to the panel — not per node:
     a fold is a statement about how the user reads the panel, and re-folding
     Cardinality on every edge click would make the persisted value meaningless.
     Selection changes therefore do NOT reset it; only a toggle does. */
  const {toggleSection, isCollapsed} = useInspectorSections();
  /** The goblin `body` switch (§C) — a SECOND-LEVEL disclosure inside the Style
   *  section, which §A.3 keeps OPEN. Session-scoped on purpose: §C names exactly
   *  ONE new persisted key, and this one control is a click away in a section
   *  the user already has open. */
  const [bodyModeOpen, setBodyModeOpen] = useState(false);

  /* ROUND AD, ITEM 5(a) — OPTION B'S CONDITION, IN STATE. `keyNoteShown` starts
     from the persisted value (absent → SHOW), and dismissing writes it through
     the ONE convention every other panel preference uses. Global to the panel,
     not per node — the note is a statement about the colour control, so it does
     not reappear on every selection change. */
  const [keyNoteShown, setKeyNoteShown] = useState(loadKeyNote);
  const dismissKeyNote = useCallback(() => {
    setKeyNoteShown(false);
    saveKeyNote(false);
  }, []);

  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef<Edge[]>(edges);
  edgesRef.current = edges;

  // ---- Part B: read-only review mode -------------------------------------
  // A view-only canvas: pan and zoom freely, touch nothing. Kept LOCAL to
  // App.tsx on purpose — it is one boolean, toggled from one toolbar button and
  // read by this same component's <ReactFlow> props and its one keydown
  // handler, so a hook in choreography.ts would add an indirection layer with a
  // single call site and no shared logic. Persistence follows the established
  // convention here (`diagram-studio:edge-path`, `diagram-studio:read-only`):
  // one namespaced key, read once in a lazy `useState` initialiser that never
  // throws when storage is unavailable, defaulting to OFF.
  //
  // K — HOISTED above the hover choreography deliberately: the gate there reads
  // this flag (`highlight && !readOnly`), so the declaration must precede that
  // call site. Every other reader sits further down and is blind to the
  // position.
  const READ_ONLY_KEY = 'diagram-studio:read-only';
  const [readOnly, setReadOnly] = useState(() => {
    try { return localStorage.getItem(READ_ONLY_KEY) === '1'; } catch { return false; }
  });
  /* AUDIT-16 — the ref mirrors `readOnly` so a handler that STARTED before the
     toggle (an in-flight connection drag) can still see the mode change when
     its drop lands; the state alone is a stale closure in that window. */
  const readOnlyRef = useRef(false);
  readOnlyRef.current = readOnly; // kept in sync every render (cheap, always right)

  // ---- PACKAGE-K: hover choreography, interaction perf guard, layout
  //      transition, animation gating. All four work on React Flow's own DOM
  //      (classList on .react-flow__node[data-id] / .react-flow__edge[data-id])
  //      and on the wrapper class, so none of them costs a React render.
  const {
    animate, toggle: toggleAnimate,
  } = useAnimationGating(nodes.length);
  /** F — the hover edge-highlight is an OPTION now, default OFF; the value is
   *  the user's persisted choice. K — the gate handed to the choreography is
   *  the option AND the absence of review mode: view-only means a hover lights
   *  nothing. `readOnly` joins the gate at the CALL SITE rather than inside the
   *  hook, which is left exactly as fix-F wrote it — including the `clear()`
   *  its disabled branch runs, and that is the point: an edge that was ALREADY
   *  electric at the instant the mode turns on must be un-painted, and `clear()`
   *  on disable is what un-paints it. A parallel guard added outside `enabled`
   *  would strand exactly that edge. */
  const {highlight, toggle: toggleHighlight} = useHoverHighlight();
  /* ROUND AA, ITEM 2 — THE MARQUEE SELECTION MODE. Hoisted beside the other
     persisted canvas prefs (`useAnimationGating`, `useHoverHighlight`), and it
     RETURNS the React Flow `selectionMode` enum as well as the stored value, so
     the live `<ReactFlow>` prop below follows the setting with no reload and
     there is no second place that could map the value differently. Default is
     `touch` (overlap); see `src/marqueeMode.ts`. */
  const {mode: marqueeMode, selectionMode, setMode: setMarqueeMode} = useMarqueeMode();
  /* CONFIG ROUND (2026-10-23) — the z-order display mode: 'wysiwyg' (manual,
     paint = stored z, the default) vs 'lift' (the library's select-raises
     behaviour). See src/zOrderMode.ts. */
  const {mode: zOrderMode, zIndexMode, setMode: setZOrderMode} = useZOrderMode();
  /* ROUND LAYOUT — THE AUTO-LAYOUT DIRECTION. Persisted Canvas preference
     (prefs.ts path, same family as grid-size): overrides the preset's own
     layout default so a flowchart board can also arrange left-right. The
     toolbar's auto-layout consumes it through useCanvasTools; Settings →
     Canvas owns the radio row. See `src/layoutMode.ts`. */
  const {layoutDir, setLayoutDir} = useLayoutDir();
  const {onEdgeMouseEnter, onEdgeMouseLeave, onNodeMouseEnter, onNodeMouseLeave} =
    useHoverChoreography(wrap, edgesRef, highlight && !readOnly);
  const {startInteraction, endInteraction} = useInteractionGuard(wrap);
  const {animateLayout} = useLayoutTransition(wrap);

  // ---- snap to grid ----
  const [snap, setSnap] = useState(false);
  /** M4: the grid pitch in px — the ONE source of truth for the snap grid, the
   *  visible dot spacing, the "round onto the grid" math and the toolbar
   *  tooltip. Owned here (session-scoped like `snap`); the toolbar keeps the
   *  on/off toggle and Settings → Canvas owns the number, so neither is a
   *  duplicate control. Never written to a board. */
  /* PACKAGE-S §S-1 — the pitch persists (was session-only, which made the
     Settings choice a lie across reloads). Lazy-init reads; the first visit
     writes nothing until the user picks (prefs.ts contract). */
  const [gridSize, setGridSize] = useState(() => loadPref('grid-size', 16));
  // ---- PACKAGE-S §S-2 — export defaults (persisted; defaults = today's behaviour) ----
  const [pngScale, setPngScale] = useState(() => loadPref('png-scale', 2));
  const onPngScale = useCallback((n: number) => {
    if (![1, 2, 3].includes(n)) return;
    setPngScale(n);
    savePref('png-scale', n);
  }, []);
  const [pngPad, setPngPad] = useState(() => loadPref('png-pad', 48));
  const onPngPad = useCallback((n: number) => {
    if (![24, 48, 96].includes(n)) return;
    setPngPad(n);
    savePref('png-pad', n);
  }, []);
  // ---- PACKAGE-S §S-3 — autosave control (default ON = today's behaviour) ----
  const [autosave, setAutosave] = useState(() => loadPref('autosave', true));
  const onAutosave = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setAutosave(prev => {
      const next = typeof v === 'function' ? (v as (p: boolean) => boolean)(prev) : v;
      savePref('autosave', next);
      return next;
    });
  }, []);
  /** The only way the pitch is set: non-finite input (cleared / partial field)
   *  is ignored — the last valid value stands — and anything finite is clamped
   *  to [4, 64] and rounded to the nearest 4px step, so `snapGrid`,
   *  `Background`'s gap and the rounding math can never disagree or go NaN. */
  const onGridSize = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const next = Math.min(64, Math.max(4, Math.round(n / 4) * 4));
    setGridSize(next);
    savePref('grid-size', next);
  }, []);
  /* HARVEY 2026-10-13 — the dblclick auto-connect setting: toggle + reach
     (clamped 150–800, 50px steps so the slider lands on sane numbers). */
  const onDblConnect = useCallback((v: boolean) => {
    setDblConnect(v);
    savePref('dbl-connect', v);
  }, []);
  const onDblRange = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const next = Math.min(800, Math.max(150, Math.round(n / 50) * 50));
    setDblRange(next);
    savePref('dbl-range', next);
  }, []);
  // ---- AQ21 — the export modal ----
  const [expOpen, setExpOpen] = useState(false);
  // ---- D1: searchable insert palette (position = double-click point) ----
  const [searchPos, setSearchPos] = useState<{x: number; y: number} | null>(null);
  // ---- D2: cheat sheet popover ----
  const [help, setHelp] = useState(false);
  // ---- F2: context menu ----
  const [ctx, setCtx] = useState<CtxTarget | null>(null);
  // ---- M3/S3: coarse-pointer handling ----
  // `isTouchScreen` is live: a hybrid laptop switching pointer flips it and the
  // drag thresholds below follow. `touchPrev` lets us notice the transition at
  // all (React has no "the media query changed" hook), so a stale context menu
  // can be dismissed the moment a coarse pointer is detected.
  const isTouchScreen = ui.isTouchScreen;
  const touchPrev = useRef(isTouchScreen);
  useEffect(() => {
    if (touchPrev.current !== isTouchScreen && isTouchScreen) setCtx(null);
    touchPrev.current = isTouchScreen;
  }, [isTouchScreen]);
  // M3/S3.1 — 500 ms long press opens the SAME context menu right-click opens.
  // The hook emits a `CtxTarget`-shaped object, so there is exactly one
  // context-menu state (`ctx`) and one renderer (`<ContextMenu>` below).
  useLongPress({
    enabled: isTouchScreen,
    container: appRef,
    onLongPress: setCtx,
  });
  // ---- F3: helper lines ----
  const [guides, setGuides] = useState<HelperGuides>({vertical: null, horizontal: null});
  /** Alignment guides + snap on drop. ON by default (auto-align); toggled from the toolbar. */
  /* PACKAGE-S §S-1 — persisted like its Canvas-pane neighbours. */
  const [alignGuides, setAlignGuidesState] = useState(() => loadPref('align-guides', true));
  const setAlignGuides = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setAlignGuidesState(prev => {
      const next = typeof v === 'function' ? (v as (p: boolean) => boolean)(prev) : v;
      savePref('align-guides', next);
      return next;
    });
  }, []);
  const helperDrag = useRef(false);
  // ---- F7: connection rules ----
  const [noCycles, setNoCycles] = useState(false);
  const [oneIn, setOneIn] = useState(false);
  /* HARVEY 2026-10-13 (batch #3) — the handle dblclick auto-connect becomes a
     SETTING: on by default, with an adjustable reach. Both persist through
     prefs.ts's lazy-init contract (nothing written until the user chooses). */
  const [dblConnect, setDblConnect] = useState(() => loadPref('dbl-connect', true));
  const [dblRange, setDblRange] = useState(() => loadPref('dbl-range', 400));
  // ---- F6: pending drop-on-canvas connection ----
  const pendingDrop = useRef<Connection | null>(null);
  // ---- G: the handle the current connection drag STARTED from.
  // Deliberately a SECOND ref rather than a field on `pendingDrop`: onConnectEnd
  // reads `pendingDrop.current` to decide whether to insert a node on drop, and
  // onConnect consumes the origin first, so clearing the shared ref there would
  // silently kill the drop-to-create path. Written by onConnectStart, consumed
  // (and cleared) by onConnect.
  const connectOrigin = useRef<{nodeId: string; handleId: string | null | undefined} | null>(null);
  // ---- G: the default edge path. `smoothstep` until the user changes an edge's
  // curvature in the inspector, at which point that choice becomes the default
  // for every edge drawn afterwards. Same convention as
  // `diagram-studio:theme`: one namespaced key, read
  // once through a lazy `useState` initialiser that never throws when storage is
  // unavailable. An absent or unparseable value reads as `smoothstep`.
  const EDGE_PATH_KEY = 'diagram-studio:edge-path';
  const readEdgePath = (): PathId => {
    try {
      const v = localStorage.getItem(EDGE_PATH_KEY);
      return v === 'bezier' || v === 'smoothstep' || v === 'step' || v === 'straight'
        ? (v as PathId)
        : 'smoothstep';
    } catch { return 'smoothstep'; }
  };
  const [defaultPath, setDefaultPath] = useState<PathId>(readEdgePath);
  const rememberEdgePath = useCallback((p: PathId) => {
    setDefaultPath(p);
    try { localStorage.setItem(EDGE_PATH_KEY, p); } catch { /* ignore */ }
  }, []);
  /** Live modifier-key state (F7 bypass) — updated by keydown/keyup listeners. */
  const shiftDown = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftDown.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftDown.current = false; };
    const blur = () => { shiftDown.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // ---- transient status message (import / export feedback) ----
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<number | undefined>(undefined);
  const flash = useCallback((msg: string) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(msg);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2500);
  }, []);

  // ---- H1/H2: onboarding — guided tour + getting-started checklist ----
  /* ONBOARD-P1 — the tour NO LONGER auto-starts and keeps NO persistence. The old
     first-visit effect wrote the `tour-seen` flag at MOUNT, i.e. before step 1 was
     ever painted (docs/PHASE-0-WALKTHROUGH.md §4 D1 measured the flag already "1"
     with zero interaction), so every visitor was recorded as having read a tour they
     may have bailed out of on the first card — and completion could never be
     measured. It now opens ONLY from the ? sheet's "Take a tour" button, always at
     step 1, and closing it (Done or Skip) writes nothing, so it stays re-openable. */
  const [tourOpen, setTourOpen] = useState(false);
  /* ROUND BI, ITEM 3 — ONE feedback dialog for the whole app: the ? help sheet
     and Settings → About both open THIS one. `feedbackReturn` is the element
     that opened it, so Esc/Cancel hands the caret back to that exact control
     (? button or the About entry) instead of the toolbar. */
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const feedbackReturn = useRef<HTMLElement | null>(null);
  const openFeedback = useCallback((from: HTMLElement | null) => {
    feedbackReturn.current = from;
    setFeedbackOpen(true);
  }, []);
  /** Discrete "user did it" signals for the checklist (idempotent per task). */
  const [doneSignal, setDoneSignal] = useState<ChecklistTaskId | null>(null);
  const tickTask = useCallback((id: ChecklistTaskId) => { setDoneSignal(id); }, []);
  /** Close the tour. ONE callback shared by Done and Skip, stable identity so the
   *  overlay's own step effects (which depend on `onDone`) do not re-run on every
   *  App render — and it writes nothing, so the tour has no persistence at all. */
  const closeTour = useCallback(() => setTourOpen(false), []);

  // ---- multi-document boards (disk-backed via dev-server API) ----
  const [curBoard, setCurBoard] = useState<BoardDoc | null>(null);
  const [boardList, setBoardList] = useState<BoardMeta[]>([]);
  const [boardsOpen, setBoardsOpen] = useState(false);

  // ---- L2: the board's diagram type (board metadata, defaults to architecture) ----
  const [presetId, setPresetId] = useState<PresetId>(DEFAULT_PRESET_ID);
  const preset = useMemo(() => getPreset(presetId), [presetId]);
  /** ERD show-mode lives on the preset but is user-overridable per session. */
  const [showMode, setShowMode] = useState<ShowMode>('ALL_FIELDS');

  /* =====================================================================
     PACKAGE-N pass 2c — the left panel shows the WHOLE library, always.

     REVISION 3 DELETED THE TYPE FILTER. Of the 34 elements, 33 belong to
     exactly ONE type, so an ARCH/FLOW/C4/ERD badge on a row merely restated
     that row's own category and the 6-chip row cost 77px of permanently
     wrapped chrome to filter the library down to almost what the category
     already held. The chips and the badges are GONE; `types[]` SURVIVES in the
     data (it is the model's membership field, read by `libraryFor` and the
     Mixed set) — only its RENDERING was removed.

     What replaces them is a SEARCH FIELD. The panel is now exactly two
     controls: a query and a fold map.

       `query`        the panel omnibox (this session only, never persisted).
                      Non-empty → the accordion is replaced by a flat list
                      grouped by category and a hit in a COLLAPSED category
                      renders dimmed rather than disappearing.
       `categories`   the durable per-section fold map (categoryState.ts).
     ===================================================================== */
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const {toggleCategory, isCategoryOpen} = useCategoryCollapse();

  // With no stored decision the board's OWN type names the one open section
  // (`defaultOpenCategory`), so a C4 board opens on C4 and an ERD board on
  // Entities without either board writing a default into localStorage just by
  // being opened. The view no longer has its own filter: the board's preset IS
  // the view, which is why this now reads `presetId` directly.
  const defaultOpen = useMemo(() => defaultOpenCategory(presetId), [presetId]);

  /** The WHOLE library in the 8 canonical sections, always — every category
   *  renders with its full count. Nothing filters this any more, so there is no
   *  "category with zero items is omitted" rule to apply (AC #8). */
  const librarySections = useMemo(
    () => groupByCategory(LIBRARY, CATEGORY_ORDER, CATEGORY_LABEL),
    [],
  );

  /** The SEARCH RESULT — the same rows, filtered by the query, still grouped and
   *  still in canonical order (empty categories dropped: an "Annotations (0)"
   *  header while searching is noise, not information). */
  const searchGroups = useMemo(
    () => groupByCategory(searchLibrary(LIBRARY, query), CATEGORY_ORDER, CATEGORY_LABEL),
    [query],
  );
  const searching = query.trim().length > 0;

  // ---- L1: the theme. A board-level theme SUGGESTS; the user's choice wins. ----
  //
  // PACKAGE-M follow-up — two things that must never be conflated:
  //   `mode`           the user's GLOBAL, persisted preference. Only an explicit
  //                    Settings pick changes it; it owns the localStorage key
  //                    `diagram-studio:theme`.
  //   `suggestedTheme` a transient, render-only proposal from the board (or a
  //                    preset). Never persisted, never in the board doc, and it
  //                    only lands for a user who has never chosen (hasStoredMode).
  // A board may recolour the screen; it may never rewrite the user's preference.
  const [mode, setMode] = useState<Mode>(() => loadMode());
  /** ITEM 1 — the DEFAULT preset's suggestion is already in force at mount
   *  (App starts on `DEFAULT_PRESET_ID`), so it belongs in the INITIAL state,
   *  not in a state pass that lands with the board load. It used to be `null`
   *  here and only became 'dark' when `adoptBoardPreset` ran ~130ms later: the
   *  first commit therefore painted the resolved OS preference (light) and the
   *  effect below flipped the document to dark on top of it. Same three inputs,
   *  same order, as the pre-paint script in index.html (see `bootTheme`). */
  const [suggestedTheme, setSuggestedTheme] = useState<ThemeName | null>(
    () => hasStoredMode() ? null : (getPreset(DEFAULT_PRESET_ID).theme.suggested ?? null),
  );
  /** The FIRST committed theme — resolved from the same inputs as the pre-paint
   *  script, so the document is already correct when React takes over. */
  const [theme, setTheme] = useState<ThemeName>(() => bootTheme(hasStoredMode()));
  const themeIsDark = isDarkTheme(theme);

  /** What is actually PAINTED: a live suggestion wins over `system` (the only
   *  mode a suggestion may override), otherwise the resolved user preference. */
  const effectiveTheme = useMemo(
    () => (mode === 'system' && suggestedTheme) ? suggestedTheme : resolveMode(mode),
    [mode, suggestedTheme],
  );

  // ---- M1: the Settings dialog (the theme is one of its settings). ----
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);

  /** The paint path. `theme` state and `applyTheme` both track `effectiveTheme`
   *  so there is exactly one place that decides what the document looks like. */
  useEffect(() => {
    setTheme(effectiveTheme);
    applyTheme(effectiveTheme);
  }, [effectiveTheme]);

  /** The Settings `onMode` handler — an EXPLICIT user choice: it persists the
   *  preference and clears any transient suggestion so the pick wins for good.
   *
   *  Persistence lives HERE and only here. It used to run in an effect on mount,
   *  which meant a plain page load fabricated a stored preference out of the
   *  'system' default — that both defeated the hasStoredMode guard below and
   *  silently converted "never chose" into "chose System". */
  const chooseMode = useCallback((m: Mode) => {
    setSuggestedTheme(null);
    setMode(m);
    saveMode(m);
  }, []);

  /** Propose (or clear, when called with no theme) a RENDER-only theme. The
   *  guard is the whole contract: suggestions stop landing for good once the
   *  user has made an explicit choice, and `mode` / localStorage stay untouched. */
  const suggestTheme = useCallback((t?: ThemeName) => {
    if (hasStoredMode()) return;
    setSuggestedTheme(t ?? null);
  }, []);

  // `system` must follow the OS preference while it is selected — but a live
  // suggestion overrides `system`, so only repaint while none is pending.
  useEffect(() => {
    if (mode !== 'system') return;
    let mq: MediaQueryList;
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch { return; }
    const onChange = () => {
      if (suggestedTheme) return;
      const t = resolveMode('system');
      setTheme(t);
      applyTheme(t);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode, suggestedTheme]);

  /** A board carries a theme suggestion; adopting it never overrides an explicit
   *  user choice. The board may change what is RENDERED only — never `mode`,
   *  never the persisted key. `suggestTheme` enforces the hasStoredMode guard. */
  const adoptBoardPreset = useCallback((doc: BoardDoc) => {
    const p = getPreset(doc.preset);
    setPresetId(p.id);
    setShowMode(p.showMode ?? 'ALL_FIELDS');
    // The on-canvas legend UI was removed (harvey, 2026-09-17) — there is no
    // state to seed. The board doc's `legend` key is still PARSED and still
    // written back unchanged on save (see `flushSave`), so a board that carries
    // it round-trips. `preset.legend` remains as DATA in `presets.ts`.
    // Never `setMode`: a suggestion is cosmetic and must not outlive the load.
    // PACKAGE-M fix — a board no longer carries a theme: only the PRESET
    // suggests one. `doc.theme` used to be read first and shadowed this
    // suggestion with a stale copy of the global preference. `suggestTheme`
    // still refuses to override a stored user preference (hasStoredMode guard).
    suggestTheme(p.theme.suggested);
  }, [suggestTheme]);

  const applyBoard = useCallback((doc0: BoardDoc) => {
    // Load a board's nodes/edges, reset history/selection, fit view.
    // Two effect runs will fire (nodes then edges state updates) — skip both.
    // K3: the wrapper carries the layout-transition class while the board's
    // nodes are swapped in, so loading never snaps.
    // L1: legacy hex colours are migrated to symbolic keys on the way in.
    // L2: the board's preset is adopted (it is board metadata; old boards have
    //     none and default to 'architecture' — zero migration).
    const doc = migrateDoc(doc0);
    adoptBoardPreset(doc);
    /* PACKAGE-N pass 3 — advance the id counter past everything on this board.
       `idc` is a module-level counter that resets to 100 on every page load,
       while a board can already contain `n100`, `n101`… (the demo board does).
       Every insert path (`addNodeByLabel`, paste, duplicate, and now a
       favourite) then mints an id that ALREADY EXISTS: React Flow keeps two
       nodes with the same id, and the next edit, selection or delete silently
       acts on the wrong one — data loss, not a cosmetic glitch.
       Bumping once per load makes a fresh id unique against the live board
       under every insert path, at a cost of one scan. (It does not cover a
       paste of many nodes in one tick, which can run ahead of the counter —
       pre-existing, out of scope, and reported rather than silently changed.) */
    for (const n of doc.nodes) {
      const m = /^n(\d+)$/.exec(n.id);
      if (m) idc = Math.max(idc, Number(m[1]) + 1);
    }
    for (const e of doc.edges) {
      const m = /^e(\d+)$/.exec(e.id);
      if (m) idc = Math.max(idc, Number(m[1]) + 1);
    }
    animateLayout(() => {
      skipAutosave.current = 2;
      past.current = [];
      future.current = [];
      setNodes(doc.nodes.map(n => ({...n, selected: false})));
      setEdges(doc.edges.map(e => ({...e, selected: false})));
      bumpHist(v => v + 1);
      setSel(null);
      setSelEdgeId(null);
      setSelCount(0);
      setCurBoard(doc);
      /* AS-5 — ARM the save gate: this is the ONE place a doc is applied after
         a successful load, so it is the one place the loaded id is set. Every
         path out of applyBoard (open, first boot, delete-reseed, duplicate)
         went through a real load. Until this line runs for the NEW doc, the
         gate is closed — a flush landing mid-switch writes nothing. */
      setBoardLoadedDocId(doc.id);
      boards.cacheLastBoard(doc.id);
      /* HARVEY 2026-10-13 — maxZoom 1: a 1-node board must not zoom to 250%. */
      setTimeout(() => rf?.fitView({padding: 0.25, maxZoom: 1}), 30);
    });
  }, [setNodes, setEdges, rf, animateLayout, adoptBoardPreset]);

  /* ROUND BN-2 — the save/load cluster now lives in usePersistence.ts
     (moved verbatim). applyBoard stays HERE (it owns the module-level idc
     bump and the undo/selection reset) and is passed in; saveTimer and
     skipAutosave come back out because two later App sites still write them
     (the board-switch cancel and the beforeunload fast flush). */
  /* GOBI-S1 — a fragment-owned boot (`#b=`) is a SHARE VIEW: the persistence
   * bootstrap must not load (or seed) the visitor's boards while it is on. */
  const shareActive = useRef(shareViewPayload() !== null);
  const [saveState, modeLabel, storageEstimate, localMode, dirty,
    flushSave, refreshBoards, saveTimer, skipAutosave] = usePersistence(
    nodes, edges, nodesRef, edgesRef, curBoard, presetId, mode, autosave,
    boardLoaded, setBoardLoaded, boardLoadedDocId, setBoardList, flash, applyBoard, shareActive);

  /* ROUND BN-2 — the boards menu cluster now lives in useBoardsMenu.ts
     (moved verbatim). boardsOpen/boardList/curBoard/presetId stay here
     (shared with usePersistence and the popover JSX) and pass down. */
  const [boardDlg, setBoardDlg, tgOpen, setTgOpen, pendingBoardName,
    closeBoardDlg, newBoard, createFromTemplate, useTemplate, closeGallery,
    boardsMenuBtnRef, boardsPopPos, boardsPopClamp, switchPreset, openBoard,
    renameBoard, doRenameBoard, doDuplicateBoard, deleteBoard, doDeleteBoard,
    onBoardDialog, boardsBtnRef] = useBoardsMenu(
    nodesRef, edgesRef, boardList, setBoardList, boardsOpen, setBoardsOpen,
    curBoard, setCurBoard, presetId, setPresetId, setShowMode, setNoCycles,
    setOneIn, suggestTheme, flushSave, saveTimer, applyBoard, flash, tickTask);


  // Item 3b: the `?` helper closes on an outside click too — the same pattern as
  // the boards menu above. The `?` button is EXCLUDED from the outside test so a
  // second click on it still TOGGLES (otherwise the global mousedown would close
  // the sheet first and the button's onClick would immediately reopen it).
  const helpBtnRef = useRef<HTMLButtonElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!help) return;
    const onDown = (e: MouseEvent) => {
      // `globalThis.Node` is deliberate: `Node` is shadowed in this file by the
      // React Flow `type Node` import, so a bare `as Node` resolves to the graph
      // node type and fails `tsc`. Same DOM intent, explicit name.
      const t = e.target as unknown as globalThis.Node;
      if (helpRef.current?.contains(t) || helpBtnRef.current?.contains(t)) return;
      setHelp(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [help]);

  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
  };

  // ---- history (undo / redo) ----
  const [past, future, bumpHist, pushHistory, undo, redo, canUndo, canRedo] = useUndoHistory(
    nodesRef, edgesRef, setNodes, setEdges, setSel, setSelCount, setSelEdgeId);

  /* GOBI-S1 — the share view route (see useShareView). `shareActive` is
   * declared above usePersistence so the bootstrap gate can read it. */
  const {shareDoc, shareError, editCopy, dismissError} = useShareView(
    setNodes, setEdges, setCurBoard, setBoardList, setBoardLoadedDocId,
    adoptBoardPreset, setReadOnly, readOnlyRef, pushHistory,
    () => rf?.fitView({padding: 0.25, maxZoom: 1}), flash, shareActive);

  /* ROUND ROTATE — the rotation write cluster (grip gesture + selection
     chord; one undo entry per gesture — see src/useRotation.ts).
     ROUND ROTATE-FIX — the edge re-measure: updateNodeInternals reads the
     React Flow store from CONTEXT and would throw above <ReactFlow>, so the
     bridge (rendered inside it) fills this ref and useRotation owns WHEN. */
  const rotateInternals = useRef<((ids: string | string[]) => void) | null>(null);
  const [onRotateGesture, onGroupRotateGesture, rotateSelection] = useRotation(nodesRef, setNodes, pushHistory, rotateInternals);

  // ---- clipboard (copy / paste / duplicate) ----
  const clipboard = useRef<Snap | null>(null);

  const copySelection = useCallback(() => {
    const selNodes = nodesRef.current.filter(n => n.selected);
    if (!selNodes.length) return;
    const ids = new Set(selNodes.map(n => n.id));
    clipboard.current = {
      nodes: selNodes.map(n => ({...n, position: {...n.position}, data: {...(n.data as any)}, selected: false})),
      edges: edgesRef.current.filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({...e})),
    };
  }, []);

  const pasteClipboard = useCallback((offset = 40) => {
    const cb = clipboard.current;
    if (!cb || !cb.nodes.length) return;
    pushHistory();
    const idMap = new Map<string, string>();
    const newNodes: Node[] = cb.nodes.map(n => {
      const id = `n${idc++}`;
      idMap.set(n.id, id);
      return {
        ...n, id, selected: true,
        position: {x: n.position.x + offset, y: n.position.y + offset},
        data: {...(n.data as any)},
      };
    });
    /* AUDIT-1 — group membership is an ID REFERENCE too: remap `parentId`
       through the same idMap used for edges. A pasted child whose group was
       NOT pasted drops out of the group (parentId deleted) instead of staying
       a ghost child of the ORIGINAL group; a pasted subgroup re-parents to the
       pasted parent. `extent: 'parent'` only makes sense with a live parent. */
    for (const nn of newNodes) {
      const pid = (nn as any).parentId as string | undefined;
      if (pid) {
        const mapped = idMap.get(pid);
        if (mapped) (nn as any).parentId = mapped;
        else { delete (nn as any).parentId; delete (nn as any).extent; }
      }
    }
    const newEdges: Edge[] = cb.edges.map(e => ({
      ...e, id: `e${idc++}`, source: idMap.get(e.source)!, target: idMap.get(e.target)!, selected: false,
    }));
    setNodes(ns => [...ns.map(n => (n.selected ? {...n, selected: false} : n)), ...newNodes]);
    setEdges(es => [...es, ...newEdges]);
    tickTask('node');
  }, [tickTask, pushHistory, setNodes, setEdges]);

  const duplicateSelection = useCallback(() => {
    copySelection();
    pasteClipboard(40);
  }, [copySelection, pasteClipboard]);

  /** Nudge every selected node by (dx, dy). Used by the arrow keys. */
  const nudge = useCallback((dx: number, dy: number) => {
    const ids = new Set(nodesRef.current.filter(n => n.selected).map(n => n.id));
    if (!ids.size) return;
    setNodes(ns => ns.map(n => ids.has(n.id)
      ? {...n, position: {x: n.position.x + dx, y: n.position.y + dy}}
      : n));
  }, [setNodes]);

  /** Delete every selected node (and its attached edges). */
  const deleteSelection = useCallback(() => {
    const ids = new Set(nodesRef.current.filter(n => n.selected).map(n => n.id));
    if (!ids.size) return;
    pushHistory();
    setNodes(ns => ns.filter(n => !ids.has(n.id)));
    setEdges(es => es.filter(e => !ids.has(e.source) && !ids.has(e.target)));
  }, [pushHistory, setNodes, setEdges]);



  // ---- F2: context menu actions ----
  /** Absolute flow position of a node (parent-relative resolved up the tree). */
  const absPos = useCallback((n: Node, all: Node[]): XYPosition => {
    let x = n.position.x, y = n.position.y;
    let pid = n.parentId;
    const guard = new Set<string>();
    while (pid && !guard.has(pid)) {
      guard.add(pid);
      const p = all.find(m => m.id === pid);
      if (!p) break;
      x += p.position.x; y += p.position.y;
      pid = p.parentId;
    }
    return {x, y};
  }, []);

  const ctxAction = useCallback((action: CtxAction, target: CtxTarget) => {
    if (action === 'addNode' && target.kind === 'pane') {
      if (rf && wrap.current) {
        /* AUDIT-7 — raw client coords: screenToFlowPosition already subtracts
           the .react-flow domNode rect internally; subtracting the wrap rect
           here too double-subtracted by (wrap - rf), zero only while the two
           rects coincide. */
        setSearchPos(rf.screenToFlowPosition({x: target.x, y: target.y}));
      } else setSearchPos({x: 200, y: 200});
      return;
    }
    if (action === 'paste') { pasteClipboard(40); return; }
    if (action === 'selectAll') {
      setNodes(ns => ns.map(n => ({...n, selected: true})));
      setEdges(es => es.map(e => ({...e, selected: true})));
      return;
    }
    if (action === 'fitView') { rf?.fitView({padding: 0.25}); return; }

    if (target.kind === 'node') {
      const id = target.id;
      const node = nodesRef.current.find(n => n.id === id);
      if (!node) return;
      if (action === 'duplicate') {
        copySelection(); // no-op if not selected; fall through to explicit copy
        clipboard.current = {nodes: [{...node, selected: true}], edges: []};
        pasteClipboard(30);
        return;
      }
      if (action === 'copy') {
        clipboard.current = {nodes: [{...node, position: {...node.position}, data: {...(node.data as any)}, selected: false}], edges: []};
        flash('Node copied');
        return;
      }
      if (action === 'delete') {
        pushHistory();
        setNodes(ns => ns.filter(n => n.id !== id));
        setEdges(es => es.filter(e => e.source !== id && e.target !== id));
        return;
      }
      if (action === 'front' || action === 'back') {
        pushHistory();
        setNodes(ns => {
          const cur = ns.find(n => n.id === id);
          if (!cur) return ns;
          const rest = ns.filter(n => n.id !== id);
          // children of a parent must stay after the parent in the array
          if (action === 'front') {
            const withP = rest.filter(n => n.parentId === cur.parentId);
            const withoutP = rest.filter(n => n.parentId !== cur.parentId);
            return [...withoutP, ...withP, cur];
          }
          // back: just before the first sibling (or at the very front)
          const firstSibling = rest.findIndex(n => n.parentId === cur.parentId);
          const at = firstSibling < 0 ? 0 : firstSibling;
          const out = [...rest];
          out.splice(at, 0, cur);
          return out;
        });
        return;
      }
      if (action === 'note') {
        // insert a Note node just below-right of this node
        pushHistory();
        const p = absPos(node, nodesRef.current);
        const nid = `n${idc++}`;
        setNodes(ns => {
          const note: Node = {
            id: nid, type: 'goblin',
            position: {x: p.x + nodeW(node) + 48, y: p.y + 12},
            data: {shape: 'note', kicker: 'note', title: 'New note', sub: '', icon: 'sticky-note', colorKey: 'slate'},
          };
          return [...ns, note];
        });
        return;
      }
    }

    if (target.kind === 'edge') {
      const id = target.id;
      const edge = edgesRef.current.find(e => e.id === id);
      if (!edge) return;
      if (action === 'editLabel') {
        setSelEdgeId(id);
        // signal the edge component to open its inline label editor
        setEdges(es => es.map(e => (e.id === id ? {...e, data: {...((e.data ?? {}) as EdgeData), __edit: Date.now()}} : e)));
        return;
      }
      if (action === 'reverse') {
        pushHistory();
        setEdges(es => es.map(e => {
          if (e.id !== id) return e;
          return {...e, source: e.target, target: e.source, sourceHandle: e.targetHandle, targetHandle: e.sourceHandle};
        }));
        return;
      }
      if (action === 'delete') {
        pushHistory();
        setEdges(es => es.filter(e => e.id !== id));
        return;
      }
    }
  }, [rf, pasteClipboard, pushHistory, setNodes, setEdges, flash, copySelection, absPos]);

  // ---- F5 node-toolbar actions: REMOVED (ITEM 2b, 2026-09-18) -------------
  // `toolbarActions` used to be injected into every node's `data` as
  // `__toolbar` and read by the three node kinds' floating action strip. Item 2
  // removed the strip, and this thread's LAST reader was `CustomShapeNode` /
  // `LabelNode` — both gone now, so the memo, the injection and the two node
  // kinds' `__toolbar` slot were removed together. Every one of the five
  // handlers here still exists under its own name and is reached from the hot
  // key or the context menu it always had (see the mapping in DiagramNode.tsx);
  // `ctxAction` in particular is still the context menu's dispatcher.

  // ---- F3 + F9 + F1: drag lifecycle ----
  const absNodes = useCallback((ns: Node[]) => {
    // cache absolute positions for helper lines / proximity / reparenting
    const map = new Map<string, {n: Node; x: number; y: number; w: number; h: number}>();
    ns.forEach(n => {
      const p = absPos(n, ns);
      map.set(n.id, {n, x: p.x, y: p.y, w: nodeW(n), h: nodeH(n)});
    });
    return map;
  }, [absPos]);
  /* ROUND BN-2 — the connection cluster now lives in useConnections.ts
     (moved verbatim; the three id-mint sites call nextId = () => idc++
     because App owns the module-level counter). pendingDrop, connectOrigin,
     readOnlyRef and shiftDown stay here — onConnectStart (the JSX) and the
     keyboard effect still write them — and pass down positionally. */
  const [createsCycle, onReconnect, onConnectEnd, onConnect, onConnectRules] = useConnections(
    nodesRef, edgesRef, setEdges, setGuides, pushHistory, tickTask, flash, rf, wrap,
    readOnlyRef, pendingDrop, connectOrigin, shiftDown, absNodes, noCycles, oneIn,
    dblConnect, dblRange, preset, defaultPath, () => idc++);

  const onNodeDrag = useCallback((_e: MouseEvent | TouchEvent, draggedNode: Node) => {
    const ns = nodesRef.current;
    const dragged = ns.find(n => n.id === draggedNode.id);
    if (!dragged) return;
    const absMap = absNodes(ns);
    const me = absMap.get(dragged.id);
    if (!me) return;

    // F3: helper lines — top-level single-node drags only (child nodes are
    // constrained by extent:'parent' and follow their group).
    // IMPORTANT: while dragging we ONLY show the guides, we never write the
    // node position (writing it every frame fights React Flow's own drag and
    // makes the node feel stuck/snapped). The snap is applied once, on drop.
    if (!dragged.parentId && alignGuides) {
      const others = [...absMap.values()].filter(v => v.n.id !== dragged.id && !v.n.parentId);
      const {guides: g} = computeHelperSnap(
        {x: me.x, y: me.y, w: me.w, h: me.h},
        others.map(v => ({x: v.x, y: v.y, w: v.w, h: v.h})),
      );
      helperDrag.current = true;
      setGuides(g);
    }

  }, [absNodes, setNodes, alignGuides]);

  const onNodeDragStop = useCallback((_e: MouseEvent | TouchEvent, draggedNode: Node) => {
    tickTask('move');
    // F3: apply the final snap (the release itself can move the node a hair)
    // then clear the helper lines.
    if (helperDrag.current) {
      helperDrag.current = false;
      const ns0 = nodesRef.current;
      const dragged0 = ns0.find(n => n.id === draggedNode.id);
      if (dragged0 && !dragged0.parentId) {
        const absMap0 = absNodes(ns0);
        const me0 = absMap0.get(dragged0.id);
        const others0 = [...absMap0.values()].filter(v => v.n.id !== dragged0.id && !v.n.parentId);
        if (me0 && others0.length) {
          const {position} = computeHelperSnap(
            {x: me0.x, y: me0.y, w: me0.w, h: me0.h},
            others0.map(v => ({x: v.x, y: v.y, w: v.w, h: v.h})),
          );
          setNodes(ns => ns.map(n => n.id === dragged0.id
            ? {...n, position: {x: Math.round(position.x), y: Math.round(position.y)}}
            : n));
        }
      }
      setGuides({vertical: null, horizontal: null});
    }

    // F1: reparent on drop — inside a group bounds → adopt; outside → release.
    const ns = nodesRef.current;
    const dragged = ns.find(n => n.id === draggedNode.id);
    if (!dragged || dragged.type === 'label') return;
    const absMap = absNodes(ns);
    const me = absMap.get(dragged.id);
    if (!me) return;

    const groups = ns.filter(n => asShape((n.data as any)?.shape) === 'group' && n.id !== dragged.id);
    // never adopt into one of my own (future) children
    const hit = groups.find(g => {
      const gp = absMap.get(g.id)!;
      return me.x >= gp.x && me.y >= gp.y && me.x + me.w <= gp.x + gp.w && me.y + me.h <= gp.y + gp.h;
    });

    if (hit && dragged.parentId !== hit.id) {
      const hp = absMap.get(hit.id)!;
      /* AUDIT-12 — no second push: onNodeDragStartAll already snapshotted the
         pre-gesture state, and the adoption is part of the SAME perceived
         gesture ("move it into the group"). Two pushes made the gesture cost
         two undos. The drag-start entry restores position AND membership. */
      setNodes(ns2 => {
        const cur = ns2.find(n => n.id === dragged.id);
        if (!cur) return ns2;
        const child: Node = {
          ...cur,
          parentId: hit.id,
          extent: 'parent' as const,
          position: {x: Math.round(me.x - hp.x), y: Math.round(me.y - hp.y)},
        };
        // keep parent before children in the array
        const without = ns2.filter(n => n.id !== dragged.id);
        const parentIdx = without.findIndex(n => n.id === hit.id);
        const out = [...without];
        out.splice(parentIdx + 1, 0, child);
        return out;
      });
      flash(`Added to group “${(hit.data as any)?.title ?? hit.id}”`);
    } else if (!hit && dragged.parentId) {
      // dragged out of its group — keep the absolute position, drop the parent
      /* AUDIT-12 — same collapse: the drag-start entry covers this. */
      setNodes(ns2 => {
        const cur = ns2.find(n => n.id === dragged.id);
        if (!cur) return ns2;
        const out: Node = {...cur, parentId: undefined, extent: undefined, position: {x: Math.round(me.x), y: Math.round(me.y)}};
        const without = ns2.filter(n => n.id !== dragged.id);
        // place after the former parent so ordering stays valid for siblings
        const pIdx = without.findIndex(n => n.id === dragged.parentId);
        const at = pIdx < 0 ? without.length : pIdx + 1;
        const arr = [...without];
        arr.splice(at, 0, out);
        return arr;
      });
      flash('Removed from group');
    }
  }, [tickTask, absNodes, pushHistory, setNodes, setEdges, flash]);

  /** History push on every node drag start (position moves are undoable). */
  const onNodeDragStartAll = useCallback((_e: MouseEvent | TouchEvent, _node: Node) => {
    pushHistory();
  }, [pushHistory]);


  /* ROUND BN-2 — the canvas tool cluster (auto-layout, z-order, align/
     distribute) now lives in useCanvasTools.ts, moved verbatim. */
  const [autoLayout, reorderSelection, align, distribute] = useCanvasTools(
    nodes, edges, nodesRef, setNodes, pushHistory, absNodes, animateLayout,
    rf, sel, zOrderMode, preset, layoutDir);


  const selected = nodes.find(n => n.id === sel);
  const selectedEdge = edges.find(e => e.id === selEdgeId) ?? null;
  const edgeMode = !!selectedEdge && selCount === 0;

  const update = (patch: Partial<NodeKind> | Partial<LabelKind>) => {
    if (!sel) return;
    pushHistory();
    setNodes(ns => ns.map(n => n.id === sel ? {...n, data: {...n.data, ...patch}} : n));
  };

  /** Patch the selected edge only. Top-level keys plus style / markerEnd / markerStart. */
  const bendDragging = useRef(false);

  /** Patch the selected edge only. Top-level keys plus style / markerEnd / markerStart.
   *
   *  `coalesce` — ROUND AM, AM-5 RESTORED THIS OPTION. ROUND T deleted it with
   *  the bend slider it existed for; the flow-speed slider introduces the same
   *  gesture shape and needs the same rule, so the machinery comes back
   *  IDENTICALLY rather than in a second form.
   *
   *  It marks a CONTINUOUS gesture — a range drag — as ONE undo step: history is
   *  recorded on the first move of the gesture only, so a 100-event drag costs
   *  ONE entry (holding the pre-drag value) rather than flooding the 50-entry
   *  stack and destroying the user's older undo steps. `src/resizeHistory.ts`
   *  records the same lesson for the resize grip ("pushing per frame would bury
   *  the user's real history under hundreds of steps — a worse bug than the one
   *  being fixed"). The gesture ENDS when the control that opened it clears the
   *  latch — see the slider's `onPointerUp` / `onKeyUp` / `onBlur`. */
  const updateEdge = useCallback((patch: Partial<Edge> & {data?: EdgeData}, replaceData = false, coalesce = false) => {
    if (!selEdgeId) return;
    if ('label' in patch) tickTask('label');
    if (!coalesce || !bendDragging.current) pushHistory();
    if (coalesce) bendDragging.current = true;
    setEdges(es => es.map(e => {
      if (e.id !== selEdgeId) return e;
      const {style, markerEnd, markerStart, data, ...rest} = patch;
      // markerEnd/markerStart: honour an explicit `none` (undefined) by REMOVING the key,
      // so the arrow head actually disappears — check for key presence, not value.
      const out = {...e, ...rest} as Edge;
      if (style !== undefined) out.style = {...(e.style ?? {}), ...style};
      if ('markerEnd' in patch) { if (markerEnd === undefined) delete out.markerEnd; else out.markerEnd = markerEnd; }
      if ('markerStart' in patch) { if (markerStart === undefined) delete out.markerStart; else out.markerStart = markerStart; }
      if (data !== undefined) out.data = replaceData ? data : {...((e.data ?? {}) as EdgeData), ...data};
      return out as Edge;
    }));
  }, [selEdgeId, tickTask, pushHistory, setEdges]);

  /** Set stroke colour everywhere it is baked in (path + both markers). */
  /** L1 — the edge colour is stored as a KEY, so the path stroke, both markers
   *  and the payload filters all recolour with the theme.
   *
   *  ROUND AO, AO-1c — IT ALSO CLEARS A LITERAL, WHICH IS THE "BACK TO A THEME
   *  COLOUR" PATH. `edgeColorPatch` does not mention `data.color`, so a literal
   *  chosen earlier would survive the spread and keep winning nothing — the key
   *  wins `resolveColor`'s precedence, so the stroke would look right — but the
   *  STALE literal would still be on the edge, and `edgeColorLiteralPatch` would
   *  later read it back into the custom cell as if it were current. Clearing it
   *  here is what makes the two writers exact inverses rather than two writers
   *  that happen to agree on the colour. */
  const setEdgeColor = useCallback((key: ColorKey) => {
    const e = edgesRef.current.find(x => x.id === selEdgeId);
    if (!e) return;
    const patch = edgeColorPatch(key, {markerEnd: e.markerEnd, markerStart: e.markerStart});
    patch.data = {...patch.data, color: undefined} as typeof patch.data;
    updateEdge(patch);
  }, [selEdgeId, updateEdge]);

  /** ROUND AO, AO-1c — the custom picker's edge writer: store the literal, drop
   *  the symbolic key, recolour the path and both markers with it. See
   *  `edgeColorLiteralPatch` for why each key is written or cleared. */
  const setEdgeColorLiteral = useCallback((hex: string) => {
    const e = edgesRef.current.find(x => x.id === selEdgeId);
    if (!e) return;
    updateEdge(edgeColorLiteralPatch(hex, {markerEnd: e.markerEnd, markerStart: e.markerStart}));
  }, [selEdgeId, updateEdge]);

  const onCommitLabel = useCallback((id: string, label: string) => {
    const cur = edgesRef.current.find(e => e.id === id);
    if (!cur || ((cur.label ?? '') as string) === label) return;
    tickTask('label');
    pushHistory();
    setEdges(es => es.map(e => (e.id === id ? {...e, label} : e)));
    setSelEdgeId(id);
  }, [tickTask, pushHistory, setEdges]);

  /* AUDIT-10 — the history entry for a bend/label gesture moves from 'start'
     to the FIRST 'move'. beginGesture fires 'start' on every pointerdown (even
     a plain click, which moves nothing), so a stray click pushed an undo entry
     that changed nothing and made the next Ctrl+Z feel dead. Now the entry is
     pushed by the first reported move: a click still selects, a drag pushes
     exactly one entry, same as before. The ref lives at component level (a hook
     inside a callback is illegal). */
  const bendGesturePushed = useRef(false);
  /* AUDIT-11 — the axis the gesture LOCKED (set on first real move, cleared on
     end). The 'end' report carries dx=dy=0, which bendAxisFor resolves to 'h'
     unconditionally — a vertical drag then stored a spurious bendX. */
  const bendGestureAxis = useRef<'h' | 'v' | 'free' | null>(null);
  /** ROUND S/T — the midpoint drag, draw.io's mechanic.
   *
   *  `'start'` records ONE history entry and selects the edge, exactly like
   *  `onNodeDragStart` / `onReconnect`: history belongs at the start of a
   *  gesture, never per pointermove, or a 200-event drag would bury the user's
   *  older undo steps.
   *
   *  `'move'` writes the waypoint the pointer is at. On `step`/`smoothstep` that
   *  is PROJECTED onto the ONE axis the gesture owns — draw.io's rule, decided
   *  from the POINTER DELTA (`dragAxis`), NOT from the geometry (that was the
   *  ROUND S bug: the generator's split decided the axis, so on any edge with
   *  more than 0.001px of stagger the axis was `h` and up/down did nothing).
   *
   *  ROUND U — the axis is decided by `bendAxisFor` and it has THREE values:
   *  `'h'`/`'v'` on the orthogonal kinds as before, and `'free'` on
   *  `bezier`/`straight`, where draw.io moves BOTH coordinates together and there
   *  is no axis to project onto. `dragPoint` is that projection in one place: the
   *  pointer on the owned axis + `edgeDrawnMid` on the other (`'h'`/`'v'`), or the
   *  raw pointer on BOTH (`'free'`). The base point matters on the orthogonal
   *  kinds because their route reads BOTH coordinates too — a horizontal drag
   *  must not drift vertically.
   *
   *  `'end'` is the auto-remove: a waypoint released within `BEND_SNAP_PX` of the
   *  generator's own default point deletes BOTH keys, so the edge goes back to
   *  the generator's clean route instead of storing a point that bends nothing.
   *  It is kind-agnostic on purpose — `plainMidpoint` is the endpoints' geometric
   *  midpoint on every kind.
   *
   *  It deliberately does NOT route through `updateEdge`: that is keyed on
   *  `selEdgeId`, so on the very first move (the one that selects the edge) it
   *  would write to the WRONG edge. */
      /* AQ15 — AUTO-GROW: a freshly created node whose text overflows the shape's
     safe band grows once to fit. `height` is the FULL node height needed (the
     renderer measured the clipped body against the wrapper). Only nodes WITHOUT
     an explicit user height are grown — the wrapper style check in the renderer
     guarantees that — so a manual resize is never overridden. Not undoable
     (it is the insert's own settling, not a user edit). */
  const onGrow = useCallback((id: string, height: number, width?: number) => {
    setNodes(ns => ns.map(n => {
      if (n.id !== id) return n;
      const style = {...(n.style ?? {})} as Record<string, string | number>;
      if (style.height && Number(style.height) >= height) return n;
      style.height = height;
      /* AQ16 — the width floors at the content's natural single-line width
         (capped 340) so long text widens the shape instead of over-wrapping.
         Only ever grows: an explicit user width is never shrunk. */
      if (width) {
        const floored = Math.max(190, width); /* .node min-width — never under */
        if (!style.width || Number(style.width) < floored) style.width = floored;
      }
      return {...n, style: style as any};
    }));
  }, [setNodes]);

  /* AQ15 — the global receiver for the renderer's auto-grow reports. */
  useEffect(() => {
    const h = (ev: Event) => {
      const {id, height, width} = (ev as CustomEvent<{id: string; height: number; width?: number}>).detail;
      onGrow(id, height, width);
    };
    window.addEventListener('gobi:node-grow', h);
    return () => window.removeEventListener('gobi:node-grow', h);
  }, [onGrow]);

const onBend = useCallback((id: string, W: Pt, phase: BendPhase, dx: number, dy: number) => {
    if (phase === 'start') {
      bendGesturePushed.current = false;
      bendGestureAxis.current = null;
      setSelEdgeId(id);
      return;
    }
    if (phase === 'move' && !bendGesturePushed.current) {
      bendGesturePushed.current = true;
      pushHistory();
    }
    setEdges(es => es.map(e => {
      if (e.id !== id) return e;
      const geo = edgeGeo(e, nodesRef.current);
      if (!geo) return e;
      const data = (e.data ?? {}) as EdgeData;
      const base = edgeDrawnMid(e, nodesRef.current);
      if (!base) return e;
      /* AUDIT-11 — the LOCKED axis. 'move' records it; 'end' carries dx=dy=0,
         which bendAxisFor would resolve to 'h' unconditionally — a vertical
         drag then stored a spurious bendX from the pointer's final-x tremor. */
      if (phase === 'move') bendGestureAxis.current = bendAxisFor(e.type, geo, dx, dy);
      const axis = phase === 'end' && bendGestureAxis.current
        ? bendGestureAxis.current
        : bendAxisFor(e.type, geo, dx, dy);
      const put: Pt = dragPoint(axis, W, base);
      if (phase === 'end') {
        bendGestureAxis.current = null;
        const pm = plainMidpoint(geo);
        if (Math.hypot(put.x - pm.x, put.y - pm.y) <= BEND_SNAP_PX) {
          const out = {...data};
          delete out.bendX;
          delete out.bendY;
          return {...e, data: out};
        }
      }
      return {...e, data: applyDrag(data, axis, put)};
    }));
  }, [pushHistory, setEdges]);

  /* ROUND AK, AK-10/AK-13 — THE LABEL DRAG AND THE CREATE-ON-DOUBLE-CLICK.

     A DELIBERATE SIBLING OF `onBend` (above), and it keeps that function's two
     load-bearing properties so the label never grows a second source of truth:

       * `pushHistory()` ONCE, on `'start'` — the convention every gesture in this
         file already documents. Never per move: a 200-event drag would bury the
         user's older undo steps.
       * it keys on the `id` the renderer hands back, NOT on `selEdgeId` — the
         first move of a drag is also the move that selects the edge, so routing
         through `updateEdge` would write to the WRONG edge (the same reason
         `onBend` does not use it).

     WHAT IT DOES NOT DO is re-derive geometry. `w` arrives finished — the
     renderer computed it, because it is the only side that holds the resolved
     path and the anchor, and since ROUND AM's AM-1 the gesture's write is
     `anchorWrite`: a displacement added to the gesture's base offset. This
     applies it.

     ROUND AM, AM-1 — THE REBASE, and why it is here rather than in the renderer.
     A write states the anchor it was measured against (`w.labelAnchor`) and
     carries the pointer's INCREMENT for this write. The stored offset is a
     running total, so the two are combined:

         corrected = stored + (storedAnchor − w.labelAnchor)     [the frame moved]
         offset    = corrected + w.labelOffset                   [this write's increment]

     The first line is what makes a label keep tracking the pointer while a NODE
     moves: the anchor moved by `Δ`, so the stored offset — expressed in the OLD
     anchor's frame — is `Δ` too large in the new one and is corrected by exactly
     that. "The line moved 30px right, so a label that was 20px right of it is now
     10px right of it": the label stays where the user's EYE put it and only the
     NUMBER changes. Without it the next write's increment would be added to an
     offset already measured from the wrong origin, and the label would drift by
     the node's movement each time. When the frames agree the correction is
     `{0,0}` and this reduces to the plain accumulation.

     `w.labelAnchor === null` is the ABSOLUTE case — the centred/reset write and
     the create commit — and it is NEVER rebased or accumulated: those offsets are
     not measured against the geometry at all, they ARE the stored value. It also
     CLEARS the stored anchor, because after it there is nothing left to measure
     against.

     THE MERGE IS MODE-DEPENDENT ON PURPOSE, and it is what keeps the stored
     document honest: a CENTRED write (`labelPinned: false`) DELETES all THREE
     keys instead of storing `{0,0}`/`true`, so "dragged back to the centre",
     "reset" and "never moved" are one stored state and a board cannot accumulate
     a key that means nothing. `labelAnchor` joins the other two on that list in
     this round — three situations, one stored state. A gesture that ENDS at the
     centre lands there through the same door: the total it writes is `{0,0}`,
     which is the pinned-but-empty case collapsed below. */
  /* AUDIT-10 twin — same deferral as onBend above: the label gesture's history
     entry lands on the first 'move', not on the pointerdown 'start'. */
  const labelGesturePushed = useRef(false);
  const onLabelWrite = useCallback((id: string, w: LabelWrite, phase: BendPhase) => {
    if (phase === 'start') {
      labelGesturePushed.current = false;
      setSelEdgeId(id);
      return;
    }
    if (phase === 'move' && !labelGesturePushed.current) {
      labelGesturePushed.current = true;
      pushHistory();
    }
    setEdges(es => es.map(e => {
      if (e.id !== id) return e;
      const data = {...((e.data ?? {}) as EdgeData)};
      if (!w.labelPinned) {
        delete data.labelOffset;
        delete data.labelPinned;
        delete data.labelAnchor;
        return {...e, data};
      }
      if (w.labelAnchor === null) {
        // ABSOLUTE (the centred/reset write, the create commit): stored as it
        // stands, and there is no frame to record.
        if (w.labelOffset.x === 0 && w.labelOffset.y === 0) {
          delete data.labelOffset;
          delete data.labelPinned;
          delete data.labelAnchor;
        } else {
          data.labelOffset = w.labelOffset;
          data.labelPinned = true;
          delete data.labelAnchor;
        }
        return {...e, data};
      }
      const stored = data.labelOffset;
      let storedAnchor = data.labelAnchor;
      /* AUDIT-9 — migration-on-first-touch. Boards pinned before ROUND AM-1
         carry labelOffset + labelPinned but NO labelAnchor. Without an anchor
         the rebase below was skipped, and the first drag teleported the label
         by whatever the geometry had drifted since the pin. One-time fix: if a
         pinned offset arrives with no stored anchor, treat the LIVE anchor as
         the one it was measured from (no rebase — the drift is absorbed), and
         this gesture plus every later one rebases correctly. */
      if (stored && !storedAnchor) {
        storedAnchor = {x: w.labelAnchor.x, y: w.labelAnchor.y};
        data.labelAnchor = {x: w.labelAnchor.x, y: w.labelAnchor.y};
      }
      const frameMoved = stored && storedAnchor
        && (storedAnchor.x !== w.labelAnchor.x || storedAnchor.y !== w.labelAnchor.y);
      const corrected = frameMoved
        ? {x: stored!.x + (storedAnchor!.x - w.labelAnchor.x), y: stored!.y + (storedAnchor!.y - w.labelAnchor.y)}
        : (stored ?? {x: 0, y: 0});
      const offset = {x: corrected.x + w.labelOffset.x, y: corrected.y + w.labelOffset.y};
      if (offset.x === 0 && offset.y === 0) {
        // the gesture's total is the centred state — the SAME stored value as
        // reset and never-moved, reached through the gesture's own door.
        delete data.labelOffset;
        delete data.labelPinned;
        delete data.labelAnchor;
      } else {
        data.labelOffset = offset;
        data.labelPinned = true;
        data.labelAnchor = w.labelAnchor;
      }
      return {...e, data};
    }));
  }, [pushHistory, setEdges]);

  /** ROUND AK, AK-13 — the double-click-on-the-path SIGNAL, written exactly as
   *  the context menu's `editLabel` branch writes `__edit`: a fresh timestamp
   *  plus the flow point the click landed on, threaded through the edge's own
   *  `data`. Read-only is a no-op — the menu that also reaches it is already
   *  inert in review mode, and this is the same defence in depth. */
  const openLabelAt = useCallback((id: string, at: Pt) => {
    if (readOnly) return;
    setEdges(es => es.map(e => (e.id === id
      ? {...e, data: {...((e.data ?? {}) as EdgeData), __editAt: {at, t: Date.now()}}}
      : e)));
  }, [readOnly, setEdges]);

  /** ROUND AN, AN-1 — CONSUME THE CREATE SIGNAL: the deletion half of the
   *  one-shot, called by the renderer from BOTH exits of the label editor
   *  (`commit` and `cancel`).
   *
   *  WHY IT HAD TO EXIST. `openLabelAt` above writes `__editAt` and, before this
   *  round, nothing in the tree deleted it — grep proved one writer and zero
   *  deleters. A one-shot that outlives its moment is permanent, so after the
   *  first create the key stayed on the edge and EVERY later rename re-entered
   *  the renderer's create branch and rewrote the label to the centred state
   *  ("nếu tôi đổi text, enter thì nó tự nhiên về lại center").
   *
   *  WHY IT DOES NOT PUSH HISTORY. The signal was never a document edit the user
   *  can see — it is UI state that happens to ride in `data`. Giving its removal
   *  an undo step would put an entry on the stack whose undo restores a signal
   *  that must not exist. `onCommitLabel`'s own rule is the same: a step that
   *  changes nothing the user can perceive must not push.
   *
   *  WHY IT TOUCHES ONE EDGE. The editor is open on one edge; the delete is
   *  keyed by that edge's id, so a stale signal on some OTHER edge is never
   *  silently swept away here — `migrateEdge` folds those on load, and this
   *  handles the live one.
   *
   *  A NO-OP WHEN THE KEY IS ABSENT (the common case): a rename of a normal,
   *  existing label takes the editor's own double-click path, never stamps the
   *  signal, and this call deletes nothing. It returns the same array object for
   *  every edge it does not change, so an ordinary rename causes no state churn
   *  and no re-render of unrelated edges. */
  const consumeEditAt = useCallback((id: string) => {
    setEdges(es => {
      const i = es.findIndex(e => e.id === id);
      if (i < 0) return es;
      const d = (es[i].data ?? {}) as EdgeData;
      if (!('__editAt' in d)) return es;
      const {__editAt: _drop, ...rest} = d;
      const next = es.slice();
      next[i] = {...es[i], data: rest as EdgeData};
      return next;
    });
  }, [setEdges]);

  /* ROUND AK, AK-13 — DOUBLE-CLICK ON THE EDGE PATH CREATES A LABEL THERE.

     WHY REACT FLOW'S OWN `onEdgeDoubleClick` AND NOT A HANDLER ON THE PATH. The
     library already renders one `<g class="react-flow__edge">` per edge with the
     handler on it, and it already owns the hit-test AK-13 asks for: the group is
     `pointer-events: visibleStroke`, so an event on it IS on the line, and
     `BaseEdge`'s `interactionWidth` widens that to a 26px band a finger can
     actually land on. A handler on the authored `<path>` would sit under that
     band. And the "was it inside an existing label?" exclusion is done by the
     DOM: the label is portalled into `.react-flow__edgelabel-renderer`, a
     SIBLING of the edge layer, so its own double-click catches that case and the
     event never reaches this handler — exactly draw.io's exclusion
     (`Graph.insertTextForEvent` creates a label only when the double-click was
     not on one).

     WHAT IT WRITES IS ONLY THE SIGNAL. It does not touch the label text or the
     position: `openLabelAt` stamps `__editAt` with the click's flow point, the
     renderer opens its editor from it, and the position is stored by the COMMIT
     if the user leaves the text empty. So a double-click that is immediately
     cancelled writes nothing at all. */
  const onEdgeDoubleClick = useCallback((e: React.MouseEvent, edge: Edge) => {
    if (readOnly || !rf || !wrap.current) return;
    // `screenToFlowPosition` is the authority this app uses for every
    // client→flow conversion, so no second conversion is compiled into the
    // renderer that could drift from these. (AUDIT-7 — raw client coords: the
    // function subtracts the domNode rect itself; the manual wrap-rect
    // subtraction here double-subtracted.)
    const at = rf.screenToFlowPosition({x: e.clientX, y: e.clientY});
    openLabelAt(edge.id, at);
  }, [readOnly, rf, openLabelAt]);

  /** ROUND AK, AK-14.1 — `Reset label position`, ONE history step.
   *
   *  It clears ALL THREE KEYS rather than storing a centred offset, which is the
   *  same state a gesture that never moved lands on — so the button and the
   *  gesture end the label in one place. Lucidchart ("Reset line"), Lucidspark
   *  and Miro all ship a reset; Miro had to add a SEPARATE touch variant, which
   *  is the tell that a desktop-only idiom would not have done.
   *
   *  ROUND AM, AM-1 — `labelAnchor` IS DELETED HERE TOO. It is the frame the
   *  stored offset was measured in, so leaving it behind after the offset is gone
   *  would be a key with nothing to describe — and the next drag would try to
   *  rebase against it. Three situations, one stored state: reset, dragged back
   *  to the centre, and never moved. */
  const resetLabelPos = useCallback(() => {
    if (!selEdgeId) return;
    pushHistory();
    setEdges(es => es.map(e => {
      if (e.id !== selEdgeId) return e;
      const data = {...((e.data ?? {}) as EdgeData)};
      delete data.labelOffset;
      delete data.labelPinned;
      delete data.labelAnchor;
      return {...e, data};
    }));
  }, [selEdgeId, pushHistory, setEdges]);

  /** ROUND AK, AK-15 — `Reverse line direction`, draw.io's Arrange → Reverse:
   *  "your connector ends and their labels will be swapped, but the path of the
   *  connector will not be changed."
   *
   *  The patch comes from `edgeLabel.reverseEdgePatch` (pure, harnessed). It
   *  returns ONLY the keys it owns — `source`/`target`, the two handles, and the
   *  legacy `offset` fraction mirrored `o → 1−o` — and those are SPLIT here
   *  because the two halves live at different depths on an edge:
   *
   *    * the top-level keys go straight onto the edge object;
   *    * the `data` half is an explicit MERGE, never `replaceData`, so
   *      `strokeKey`, `bendX`/`bendY`, `labelOffset`, `flow` and every sibling
   *      survive by construction rather than by a copy that could drift.
   *
   *  IT DOES NOT GO THROUGH `updateEdge`, for the reason `onBend` gives: that is
   *  keyed on `selEdgeId` and this is keyed on the edge whose BUTTON was pressed,
   *  so a stale selection could reverse the wrong line. The handles travel with
   *  their nodes, which is why `sourceHandle`/`targetHandle` must swap too — an
   *  ERD edge's handles name a COLUMN, and swapping the ends without them would
   *  attach the line to the wrong face of each box. */
  const reverseEdgeDir = useCallback((id: string) => {
    const cur = edgesRef.current.find(e => e.id === id);
    if (!cur) return;
    const patch = reverseEdgePatch(cur as any);
    pushHistory();
    setEdges(es => es.map(e => {
      if (e.id !== id) return e;
      const {data, ...top} = patch;
      const out = {...e, ...top} as Edge;
      if (data !== undefined) out.data = {...((e.data ?? {}) as EdgeData), ...data};
      return out as Edge;
    }));
  }, [pushHistory, setEdges]);

  /* ROUND S (2026-09-18) — the Text node's in-place editor commits here.

     A DELIBERATE SIBLING OF `update()` (App.tsx:1682), not a second
     implementation of it. It keeps BOTH of that function's load-bearing
     properties, so the field never grows a second source of truth:

       * `pushHistory()` ONCE PER COMMIT. The draft lives in `LabelNode`'s own
         state, so a keystroke calls nothing; this runs once, on commit — the
         same discipline as `onCommitLabel` above and the edge editor.
       * the same `map(n => n.id === id ? {…, data:{…n.data, patch}} : n)` shape,
         so nothing else on the node's data is clobbered.

     THE ONE DIFFERENCE IS THE KEY, and it is the point: `update()` is keyed on
     `sel` because the inspector edits whatever is selected, while this is keyed
     on the `id` the double-clicked node handed back — so the editor writes to
     the node under the pointer even when the selection says otherwise.

     `setSel(id)` mirrors `onCommitLabel`'s `setSelEdgeId(id)`: the inspector
     then shows the node that was just edited.

     The no-op guard is `onCommitLabel`'s, for the same reason — a blur that
     changed nothing must not push a history entry the user never asked for. */
  const commitLabelText = useCallback((id: string, text: string) => {
    const cur = nodesRef.current.find(n => n.id === id);
    if (!cur || (((cur.data as any)?.text ?? '') as string) === text) return;
    tickTask('node');
    pushHistory();
    setNodes(ns => ns.map(n => (n.id === id ? {...n, data: {...n.data, text}} : n)));
    setSel(id);
  }, [tickTask, pushHistory, setNodes]);

  /** Edges get the label-commit callback + their path kind through data (custom
   *  edges only). L3c: crow's-foot markers are hand-authored SVG, so their
   *  `markerStart`/`markerEnd` become `url(#id)` here — derived from the data,
   *  so a theme switch needs no edge rewrite. */
  const rfEdges = useMemo(
    () => edges.map(e => {
      if (!isGoblinEdge(e.type)) return e;
      const crowStart = edgeMarkerUrl(e, 'start');
      const crowEnd = edgeMarkerUrl(e, 'end');
      const stroke = resolveColor(e.data as any);
      return {
        ...e,
        // L1: the rendered stroke is resolved from the symbolic key, so the
        // path, the payload filter, the envelope flap and the arrowhead all
        // recolour with the theme.
        style: {...e.style, stroke},
        ...(crowStart ? {markerStart: crowStart} : null),
        ...(crowEnd ? {markerEnd: crowEnd} : null),
        data: {
          ...((e.data ?? {}) as EdgeData),
          __type: e.type,
          onCommitLabel,
          // ROUND S: the midpoint drag. Per-edge, like the two callbacks above
          // — the edge renderer owns the handle and reports a pointer position;
          // the handler lives here because it writes `edges` state.
          __onBend: onBend,
          /* AQ15 — auto-grow on create: the renderer reports a clipped body
             and the node's needed height; this grows node.style.height, the
             exact write a manual resize performs. */
          __onGrow: onGrow,
          /* ROUND AK — AK-10's label drag, threaded per-edge for the reason
             above. `onLabelWrite` receives the FINISHED write: the renderer
             applies `labelWrite`, because only it holds the resolved path, the
             anchor and the measured label box. (AK-13's double-click is wired at
             the EDGE GROUP, `onEdgeDoubleClick` below — React Flow owns that
             handler and the hit-test with it.) */
          __onLabelWrite: onLabelWrite,
          /* ROUND AN, AN-1 — the DELETE half of the `__editAt` one-shot. The
             renderer calls it from `commit` AND from `cancel`, so the create
             signal ends with the editor session that opened it and a later
             rename can no longer re-enter the centred-write branch. Same
             per-edge threading as the three keys around it — the renderer does
             not own `edges` state, so the deletion lives here. */
          __consumeEditAt: consumeEditAt,
          // FB-L: the edge renderer owns the label's inline editor, so the
          // review-mode flag has to reach it per-edge — same shape as the two
          // keys above. Read-only keeps the label readable; it never opens the
          // input.
          readOnly,
        },
      };
    }),
    [edges, onCommitLabel, readOnly, onBend, onLabelWrite, consumeEditAt, onGrow],
  );

  /** L3c: the symbolic keys whose crow's-foot glyphs this board needs. Keyed by
   *  KEY (not hex) so one <defs> set serves every theme — the glyph paints from
   *  `var(--c-*)` and the theme cascades. */
  const crowKeys = useMemo(() => {
    const ks = new Set<ColorKey>();
    edges.forEach(e => { if (hasCrow(e, 'start') || hasCrow(e, 'end')) ks.add(edgeStrokeKeyOf(e)); });
    return [...ks];
  }, [edges]);

  /** L3c: table nodes receive the board's show-mode and their own collapse
   *  handler. ITEM 2b removed the `__toolbar` injection — the action strip it
   *  fed no longer exists in any node kind, so there is nothing to inject. */
  const rfNodes = useMemo(
    () => nodes.map(n => {
      /* K — DEFECT 2: re-apply React Flow's `noPanClassName` token to the node
         WRAPPER while review mode is on. RF only writes that class itself while
         the node is draggable (`[noPanClassName]: isDraggable` in
         @xyflow/react's NodeWrapper), so `nodesDraggable={false}` REMOVES it and
         a drag starting on a node falls through to the pane and pans the canvas
         — the node then travels with the viewport and reads as "dragging the
         element". Outside review mode `n.className` is passed straight through,
         byte-for-byte as before: there RF sets the token itself. */
      const nodeClassName = readOnly ? [n.className, NO_PAN].filter(Boolean).join(' ') : n.className;
      /* ROUND S — the `label` kind's in-place editor is rendered by
         `src/nodes/LabelNode.tsx`, and a custom node component receives only its own
         `data`. So the commit callback and the review-mode flag travel through
         `data`, per-node — exactly how the edge renderer gets `onCommitLabel`
         and `readOnly` in `rfEdges` above (fix L). Read off the node's OWN
         type, so no other kind is touched. */
      /* ROUND ROTATE — the grip + its writer travel per-node (a custom node
         component receives only its own data; the same threading the label
         and table kinds use above). GROUP-ROTATE: the writer is injected on
         EVERY selected node (the chord path needs no per-node data), but the
         SOLE-SELECTION token `__rotateSel` only on the single selected one —
         in a multi-selection no per-node grip renders and App's shared
         GroupRotateGrip drives the group instead. */
      const rotData = n.selected ? {
        __rotate: onRotateGesture,
        ...(selCount === 1 ? {__rotateSel: true} : {}),
      } : {};
      if (n.type === 'label') {
        return {
          ...n,
          className: nodeClassName,
          data: {
            ...((n.data ?? {}) as any),
            onCommitText: commitLabelText,
            readOnly,
            ...rotData,
          },
        };
      }
      if (n.type === 'table') {
        return {
          ...n,
          className: nodeClassName,
          data: {
            ...((n.data ?? {}) as any),
            __showMode: showMode,
            __onToggle: (id: string, collapsed: boolean) => {
              pushHistory();
              setNodes(ns => ns.map(m => m.id === id ? {...m, data: {...(m.data as any), collapsed}} : m));
            },
            ...rotData,
          },
        };
      }
      /* memo safety: an UNSELECTED node's data object stays reference-equal
         (a new data object per recompute would defeat DiagramNode's memo). */
      return n.selected
        ? {...n, className: nodeClassName, data: {...((n.data ?? {}) as any), ...rotData}}
        : {...n, className: nodeClassName};
    }),
    [nodes, showMode, pushHistory, setNodes, readOnly, commitLabelText, onRotateGesture, selCount],
  );

  /* ---------------------------------------------------------------------
     PACKAGE-N 2b — insertion is keyed on IDENTITY, never on a rendered index.

     Both insert paths used to carry an index into the active preset's palette
     array: the drag payload was the index the panel rendered, and
     `SearchPalette` passed its own list index.
     That only worked while every caller rendered the SAME array it resolved
     against. The panel now renders a FILTERED subset of the one library, so a
     rendered index and a library index are different numbers and the mismatch is
     silent — the user drags one shape and gets another. `label` is unique across
     `LIBRARY` (verified: zero duplicates), which makes it the stable identity to
     travel with. Everything below the lookup is the previous body verbatim.
     --------------------------------------------------------------------- */
  const addNodeByLabel = (label: string, pos?: {x: number; y: number}) => {
    const item = LIBRARY.find(p => p.label === label);
    if (!item) return;
    const id = `n${idc++}`;
    /* AUDIT-14 — the no-position default centres on the WRAP (a client coord:
       rect.left + half), so with the palette open the insert lands at the
       canvas centre like every sibling path, not 480 client px from the
       viewport origin (~248 flow px off). */
    const wr3 = wrap.current?.getBoundingClientRect();
    const p = pos ?? (rf && wr3
      ? rf.screenToFlowPosition({x: wr3.left + wr3.width / 2, y: wr3.top + wr3.height / 2})
      : {x: 480, y: 300});
    pushHistory();
    tickTask('node');

    // L3c: the ERD `table` node is its own node type (a column list is not a
    // Shape — its height varies with the number of columns).
    if (item.label === 'Table' && preset.id === 'erd') {
      setNodes(ns => [...ns, {
        id, type: 'table', position: p, selected: false,
        style: {width: 250, height: 170},
        data: {
          name: 'new_table',
          columns: [
            {id: `c${idc++}`, name: 'id', type: 'uuid', pk: true, notNull: true},
            {id: `c${idc++}`, name: 'created_at', type: 'timestamptz', notNull: true},
          ],
          colorKey: 'cyan',
        } as any,
      }]);
      return;
    }

    const data = item.make() as any;
    const shape = asShape(data?.shape);
    // C3: the palette item owns the box, so NodeResizer's baseline and the
    // persisted style agree by construction. GOBI-SIZE (src/nodeSizes.ts) gave
    // every kind an explicit size, which RETIRES the group/note fallbacks that
    // used to sit here as a SECOND, quietly different answer (320x200 / 200x90).
    const size = item.size;
    /* AQ19 — CENTRE THE NODE UNDER THE CURSOR: `p` is the cursor/flow point and
       RF anchors node.position at the TOP-LEFT, so a dropped node always sat
       down-right of where the user pointed. Offset by half the node's known
       size (every palette row has one — GOBI-SIZE made `size` REQUIRED on
       PaletteItem) — every insert path funnels the cursor point through here
       or its sibling inserters. */
    const half = {w: size.width / 2, h: size.height / 2};
    const centre = {x: p.x - half.w, y: p.y - half.h};
    // L3a: a flowchart node defaults to vertical handles and a label-only body.
    if (preset.id === 'flowchart' && shape !== 'group' && shape !== 'note') {
      data.handles = 'tb';
      data.body = 'label-only';
    }
    /* ITEM — NODE TEXT DEFAULTS TO CENTRE + MIDDLE, NEW NODES ONLY (2026-10-22).

       Harvey: new nodes should read centred. The inherited defaults live in
       `alignForBody`/`vAlignForBody` (`src/textStyle.ts`): `left` + `top` for a
       card, `center` + `middle` for a label-only body. Changing THOSE would
       repaint every stored board (absence is the value that renders), so the
       default moves at INSERT TIME instead: a new node stores
       `textStyle: {align: 'center', vAlign: 'middle'}` explicitly. The values
       are deliberately stored even where they collide with the inherited
       fallback (a label-only body already centres) — the stamp is a statement
       about the NODE ("this box is a centred box"), not about the sheet, and
       the inspector shows both keys as chosen, which is the truth.

       Stored boards never pass through here, so old nodes keep exactly the
       pixels they had. The `{align, vAlign}` literal is a NEW-NODE constant,
       not a value the user chose, but the §E.2 probe's ban on literals targets
       WRITE-PATH constructions in this file — the lazy-merge writers — and this
       is an insert-path default, the same class as the flowchart
       `handles: 'tb'` / `body: 'label-only'` stamps directly above. */
    data.textStyle = {align: 'center', vAlign: 'middle'};
    setNodes(ns => [...ns, {
      id, type: item.kind, position: centre, data: {...data, __dropAt: p}, selected: false,
      style: {width: size.width, height: size.height},
    }]);
    /* AQ19 — the estimated half-size differs from the RENDERED box (content,
       font, auto-grow), so after the node mounts and settles, re-measure and
       shift it so its CENTRE sits exactly on the drop point. One extra tick,
       idempotent (reads __dropAt, then clears it). */
    window.setTimeout(() => {
      const el = document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
      if (!el || !rf) return;
      const rr = el.getBoundingClientRect();
      if (!rr.width || !rr.height) return;
      setNodes(ns => ns.map(n => {
        if (n.id !== id || !(n.data as any)?.__dropAt) return n;
        const at = (n.data as any).__dropAt as {x: number; y: number};
        /* the rendered box is CLIENT coords — convert its centre to FLOW
           space before comparing with __dropAt (mixing the two spaces at
           non-1 zoom teleports the node — caught live at 0.53 zoom). */
        const cf = rf.screenToFlowPosition({x: rr.x + rr.width / 2, y: rr.y + rr.height / 2});
        const dx = at.x - cf.x;
        /* AQ19d — X-ONLY on BOTH passes now. The grow ladder's first steps
           (60/150ms) land BEFORE this 320ms pass, so a cylinder is already
           taller than the estimate here; a Y-recentre after that growth reads
           as the node jumping UP ~1s after the drop (Harvey). Vertical is
           decided at insert time and never revisited — growth extends
           downward from the placed head. */
        if (Math.abs(dx) < 1) return n;
        return {...n, position: {x: n.position.x + dx, y: n.position.y}, data: {...n.data}};
      }));
    }, 320);
    /* second pass after the auto-grow ladder settles (400/900ms steps) so a
       node that GREW after the first pass still ends centred; the flag is
       cleared here. */
    window.setTimeout(() => {
      const el = document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
      if (!el || !rf) return;
      const rr = el.getBoundingClientRect();
      if (!rr.width || !rr.height) return;
      setNodes(ns => ns.map(n => {
        if (n.id !== id || !(n.data as any)?.__dropAt) return n;
        const at = (n.data as any).__dropAt as {x: number; y: number};
        const cf = rf.screenToFlowPosition({x: rr.x + rr.width / 2, y: rr.y + rr.height / 2});
        const dx = at.x - cf.x;
        /* HARVEY 2026-10-16 — X-ONLY on this pass. A cylinder auto-grows ~2.2×
           taller on this ladder; re-centring Y after that growth yanks the node
           UP ~1s after the drop (the grown body pulls the head back to the
           drop point). The user placed the HEAD — growth belongs BELOW it, so
           vertical is anchored at pass 1 and never touched again. */
        const data = {...n.data};
        delete data.__dropAt;
        if (Math.abs(dx) < 1) return {...n, data};
        return {...n, position: {x: n.position.x + dx, y: n.position.y}, data};
      }));
    }, 1150);
  };

  // ---- D1: insert via the searchable palette ----
  const insertFromSearch = useCallback((label: string) => {
    if (!searchPos) return;
    addNodeByLabel(label, searchPos);
    setSearchPos(null);
  }, [searchPos]);

  /* =====================================================================
     PACKAGE-N §6 — FAVOURITES (pass 3).

     The user's starred shapes, mirrored in component state and persisted to
     `/api/library` (§7, `src/library.ts`). Three rules shape the code below:

     1. THE PANEL NEVER WAITS ON THE NETWORK. `favourites` starts `[]` and the
        mount GET only ever REPLACES it when it succeeds. A failed GET is
        caught and ignored — an unreachable library must leave a working panel,
        not an error state or an unhandled rejection.
     2. STATE IS OPTIMISTIC. A star click updates `favourites` immediately and
        persists in the background; if the PUT fails we KEEP the local change
        (the user's work is not thrown away) and say so (§7.2 #4 — the library
        has no server copy, so "export it to a file" is the honest advice).
     3. A TOGGLE READS `prev`, NEVER A CLOSURE COPY. Two star clicks landing in
        one tick would both compute from the list as it was before the first,
        and the second silently drops the first. Worse, under StrictMode an
        updater runs TWICE, so the persist cannot live inside it either — the
        write is deferred past the commit and reads the committed list from a
        ref. That is why every mutation goes through `mutateFavourites`.
     ===================================================================== */
  const [favourites, setFavourites] = useState<library.Favourite[]>([]);
  /** Mirror of `favourites` for the persist step (same pattern as `nodesRef`):
   *  the write reads the list React has actually COMMITTED, never a closure
   *  copy that a same-tick second edit could have made stale. */
  const favouritesRef = useRef<library.Favourite[]>(favourites);
  favouritesRef.current = favourites;

  /* ---------------------------------------------------------------------
     PACKAGE-N §8.1–§8.2 pass 4b — the USER'S IMPORTED SHAPES, state only.

     Same three rules as the favourites block above, for the same reasons:

     1. THE PANEL NEVER WAITS ON THE NETWORK. `shapes` starts `[]` and the
        mount GET only ever REPLACES it on success; a failed GET leaves an
        empty list, never an error state.
     2. STATE IS OPTIMISTIC. Importing a shape updates `shapes` immediately and
        persists in the background; a failed PUT keeps the local change.
     3. THE WRITE READS THE COMMITTED LIST FROM A REF (`shapesRef`), so a
        persist deferred past the commit can never serialise a stale array.

     ONE EXTRA RULE HERE — §8.2 rule 8, THE STORED FILE IS UNTRUSTED. Whatever
     `/api/library` hands back goes through `parseCustomShapeEntry` before it
     reaches this state: a hand-edited, foreign or older-build entry is dropped
     (and so never reaches the canvas). This is the cheap structural gate; the
     component renders through `svgDataUri` into an `<img>`, which is the
     second, independent guard.
     --------------------------------------------------------------------- */
  const [shapes, setShapes] = useState<CustomShape[]>([]);
  /** Mirror of `shapes` for the persist step — see `favouritesRef`. */
  const shapesRef = useRef<CustomShape[]>(shapes);
  shapesRef.current = shapes;

  useEffect(() => {
    let alive = true;
    library.getLibrary()
      .then(doc => {
        if (!alive) return;
        setFavourites(Array.isArray(doc?.favourites) ? doc.favourites : []);
        // §8.2 rule 8 — gate EVERY stored entry, keep only what parses.
        const stored = Array.isArray((doc as any)?.shapes) ? (doc as any).shapes : [];
        const parsed: CustomShape[] = [];
        for (const entry of stored) {
          const res = parseCustomShapeEntry(entry, gridSize);
          if (res.ok) parsed.push(res.shape);
        }
        setShapes(parsed);
      })
      .catch(() => { /* offline / not yet stored — an empty panel is correct */ });
    return () => { alive = false; };
    /* DELIBERATELY mount-only (the block's deps are unchanged from the
       favourites-only version). `gridSize` is read here only to CLAMP the size
       of a shape off disk, and any pitch yields a legal clamped size; adding it
       to the deps would re-fetch on every pitch change and clobber optimistic
       local state with the server copy — a worse failure than a stale clamp
       that the next load corrects anyway. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Persist the library. Always called with the lists the caller has ALREADY
   *  decided to commit — never with a ref read at write time.
   *
   *  WHY THE LISTS ARE ARGUMENTS (measured bug, 2026-09-17): the write used to
   *  read `shapesRef.current` after a `setTimeout(0)`. That is only correct when
   *  the mutation happens in a SYNCHRONOUS event handler, because then React
   *  commits before the timer fires. The IMPORT path is different: it awaits
   *  `file.text()`, so it resumes as a microtask — the timer (a macrotask) fires
   *  FIRST, reading the ref before React has committed. Measured: the PUT left at
   *  **+2 ms carrying the PRE-import list**, while the DOM committed the new count
   *  at **+27 ms**. The visible effect was a server library permanently one
   *  import behind the panel (panel 4 / server 3), and a reload silently lost the
   *  newest shape. Passing the lists explicitly removes the dependency on WHEN
   *  the caller resumed.
   *
   *  It sends the CURRENT favourites too: the PUT replaces the whole document,
   *  so a shapes-only write would blank the user's favourites. */
  const persistLibrary = useCallback(async (
    favourites: library.Favourite[],
    shapes: CustomShape[],
  ) => {
    try {
      await library.saveLibrary(library.libraryDoc(favourites, shapes));
    } catch {
      // §7.2 #4 — never fail silently. Excalidraw's wording: the store is not
      // the user's only copy, and a file export is the escape hatch.
      flash("Couldn't save the library. Export it to a file so you don't lose changes.");
    }
  }, [flash]);

  /** The ONE way favourites change: a PURE updater, then a persist.
   *
   *  The updater must be pure because `setFavourites` updaters run TWICE under
   *  StrictMode. It must also read `prev` rather than a closure copy: two star
   *  clicks landing in one tick would otherwise both compute from the list as
   *  it was before the first one, and the second would silently drop the first
   *  (verified live — Queue vanished when Queue and Service were toggled in the
   *  same tick). The write therefore CANNOT live inside the updater; it is
   *  deferred past the commit and carries the list computed HERE.
   *
   *  `favouritesRef` is advanced SYNCHRONOUSLY, before `setState`, so a second
   *  mutation in the same tick computes from the first one's result instead of
   *  from stale state. React re-assigns the ref on the next render anyway, so
   *  the early write is invisible and only closes the window. */
  const mutateFavourites = useCallback(
    (updater: (prev: library.Favourite[]) => library.Favourite[]) => {
      const next = updater(favouritesRef.current);
      favouritesRef.current = next;
      setFavourites(next);
      window.setTimeout(() => { void persistLibrary(next, shapesRef.current); }, 0);
    },
    [persistLibrary],
  );

  /** §6.3 — the star control. Add when absent, remove when present. */
  const toggleFavourite = useCallback((item: PaletteItem) => {
    mutateFavourites(prev => library.toggleFavouriteItem(prev, item));
  }, [mutateFavourites]);

  /** ROUND AB, ITEM 2 — remove ONE favourite from the strip.
   *  ROUND AE — RE-KEYED ON THE ID, AND EVERY TILE NOW CARRIES IT.
   *
   *  The tile calls exactly this, through the same `mutateFavourites` writer the
   *  palette star uses, so the strip and the star cannot drift and the write
   *  keeps the ref-synchronous + deferred-persist contract.
   *
   *  WHY IT IS NO LONGER THE LABEL. A favourite saved from a SELECTION has no
   *  `__label`, so `favouriteLabel` returns `undefined` for it — and matching on
   *  that would remove EVERY unnamed favourite in one call. Round AB therefore
   *  rendered the control only where a label existed, which left a
   *  selection-saved favourite with NO removal path at all. `f.id` is the one
   *  field that is always present and unique (the tile already keys on it and
   *  the drag payload already carries it), so it is the honest identity.
   *
   *  The label-based `library.removeFavouriteItem` is NOT dead: it is still the
   *  arm of `toggleFavouriteItem`, i.e. what the palette star removes through.
   *  This function reaches `removeFavouriteById` instead, so there are two
   *  library helpers and ONE app-level removal, not a third mechanism. */
  const removeFavourite = useCallback((id: string) => {
    mutateFavourites(prev => library.removeFavouriteById(prev, id));
  }, [mutateFavourites]);

  const isStarred = useCallback(
    (label: string) => library.isFavouriteItem(favourites, label),
    [favourites],
  );

  /** §6.4 — the pending `+` tile: "add from selection". The stored payload
   *  carries each node's offset from the selection's corner (`__rel`), so the
   *  group keeps its internal layout while the insert re-derives the absolute
   *  geometry onto the drop point (§6.5). Prepend — the newest is on top. */
  const addFavouriteFromSelection = useCallback(() => {
    const selNodes = nodesRef.current.filter(n => n.selected);
    if (!selNodes.length) return;
    const ids = new Set(selNodes.map(n => n.id));
    // Built OUTSIDE the updater (it reads refs, not state) — the updater below
    // only has to be pure, not to re-derive the payload.
    const fav = library.favouriteFromSelection(selNodes, edgesRef.current.filter(
      e => ids.has(e.source) && ids.has(e.target),
    ));
    mutateFavourites(prev => [fav, ...prev]);
    flash(`Saved ${selNodes.length} node${selNodes.length === 1 ? '' : 's'} to Favourites`);
  }, [mutateFavourites, flash]);

  /** §6.5 — insert a favourite. NEVER trust stored geometry: re-generate ids,
   *  re-centre on the drop point, snap to `gridSize`, then select what landed.
   *
   *  A single-node favourite that still carries its palette label goes through
   *  the ONE canonical palette payload (`LIBRARY.find`), so the `Table`/erd
   *  special case and the container sizing in `addNodeByLabel` apply verbatim.
   *  Anything else is re-derived from the stored payload: shape, colourKey and
   *  the node `type` all come from data, and the geometry from the drop point. */
  const insertFavourite = useCallback((fav: library.Favourite, pos?: {x: number; y: number}) => {
    const label = library.favouriteLabel(fav);
    /* §6.5 step 2 — SNAP TO THE GRID. Unconditional, and deliberately NOT tied
       to the `snap` toolbar toggle: `addNodeByLabel` inserts at the raw drop
       point, but a favourite's geometry is stored as offsets only, so the drop
       point is the ONE thing that decides where the group lands. AC #17 tests
       this, so the favourite path always quantises to `gridSize`. */
    const snapTo = (v: number) => Math.round(v / gridSize) * gridSize;
    const drop = pos ?? (rf
      ? rf.screenToFlowPosition({
        x: (wrap.current?.clientWidth ?? 900) / 2,
        y: (wrap.current?.clientHeight ?? 600) / 2,
      })
      : {x: 480, y: 300});

    if (label && fav.nodes.length === 1) {
      // Identity path: the palette item rebuilds the payload, so no stored
      // field is trusted, and `Table` / group sizing / flowchart handles all
      // keep working because this IS the add path.
      const item = LIBRARY.find(p => p.label === label);
      if (item) {
        const before = new Set(nodesRef.current.map(n => n.id));
        addNodeByLabel(label, {x: snapTo(drop.x), y: snapTo(drop.y)});
        // §6.5 step 4 — select what landed. The insert commits to state a tick
        // later than this call, so the selection follows on the next tick.
        window.setTimeout(() => {
          const added = nodesRef.current.filter(n => !before.has(n.id)).map(n => n.id);
          if (!added.length) return;
          const ids = new Set(added);
          setNodes(ns => ns.map(n => ids.has(n.id) ? {...n, selected: true} : {...n, selected: false}));
        }, 0);
        return;
      }
      // A stored label that no longer exists in the library falls through to
      // the generic path rather than silently inserting nothing.
    }

    pushHistory();
    tickTask('node');
    const idMap = new Map<string, string>();
    const stored = fav.nodes as FavouriteNode[];
    /* §6.5 step 1 — RE-CENTRE. `__rel` is a node's offset from the favourite's
       own top-left, so the group's BOUNDING BOX CENTRE is what lands on the
       drop point: the offsets are kept exact (the internal layout is the one
       thing worth preserving) and only the anchor is quantised to the grid. */
    const offs = stored.map(n => {
      const rel = (n as any)[library.REL_KEY];
      return rel && typeof rel.x === 'number' && typeof rel.y === 'number'
        ? {x: rel.x, y: rel.y}
        : null;
    });
    const known = offs.filter(Boolean) as {x: number, y: number}[];
    const centre = known.length
      ? {
        x: (Math.min(...known.map(o => o.x)) + Math.max(...known.map(o => o.x))) / 2,
        y: (Math.min(...known.map(o => o.y)) + Math.max(...known.map(o => o.y))) / 2,
      }
      : {x: 0, y: 0};
    const anchor = {x: snapTo(drop.x) - centre.x, y: snapTo(drop.y) - centre.y};

    const newNodes: Node[] = stored.map((storedNode, i) => {
      /* Two stored payload shapes are legal (see `library.ts`): a plain palette
         payload, or a stripped node wrapper. `payload` is whichever object
         actually holds the node `data`; the marker keys are dropped from it. */
      const payload = (storedNode?.data ?? storedNode) as any;
      const {[library.LABEL_KEY]: _l, [library.REL_KEY]: _r, __src: _s, ...payloadData} = payload;
      void _l; void _r; void _s;
      const rel = offs[i] ?? {x: 0, y: 0};
      // §6.5 step 3 — RE-GENERATE IDS. Never reuse a stored one: it may collide
      // with an id already on this board.
      const id = `n${idc++}`;
      // A selection copy stores no board id at all, so `__src` is its only
      // reference; `storedNode.id` covers a hand-written library file that did
      // keep one.
      // `FavouriteNode` is `Record<string, unknown>`: the reference fields are unknown
      // until narrowed. `String()` is the honest key-maker (the old code relied on `any`).
      idMap.set(String(storedNode.__src ?? storedNode.id ?? i), id);
      return {
        id,
        type: (storedNode.type ?? 'goblin') as string,
        position: {x: anchor.x + rel.x, y: anchor.y + rel.y},
        data: payloadData,
        // A selection copy keeps its own `style` (a container's size); a
        // palette payload never had one, so nothing is invented here.
        ...(storedNode.style ? {style: storedNode.style} : null),
        selected: true,
      } as Node;
    });

    const newEdges: Edge[] = (fav.edges ?? []).map((se: Edge) => {
      const {selected: _sel, ...rest} = se;
      void _sel;
      const src = idMap.get(se.source) ?? idMap.get(String(se.source));
      const tgt = idMap.get(se.target) ?? idMap.get(String(se.target));
      return src && tgt ? ({...rest, id: `e${idc++}`, source: src, target: tgt, selected: false} as Edge) : null;
    }).filter(Boolean) as Edge[];

    setNodes(ns => [...ns.map(n => (n.selected ? {...n, selected: false} : n)), ...newNodes]);
    if (newEdges.length) setEdges(es => [...es, ...newEdges]);
  }, [addNodeByLabel, gridSize, pushHistory, setNodes, setEdges, rf, tickTask]);

  /* =====================================================================
     PACKAGE-N §8.1–§8.3 pass 4b — CUSTOM-SHAPE library mutations.

     `insertCustomShape` is the CANVAS half (the import UI is pass 4c): it is
     the only place a custom shape becomes a node. Two §6.5 rules carry over
     from the favourite path verbatim — the id is re-derived from the module
     counter and the position is re-quantised to the grid, because a stored
     coordinate is not a thing to trust.
     ===================================================================== */

  /** Insert an imported shape at `pos` (or the viewport centre), grid-quantised. */
  const insertCustomShape = useCallback((shape: CustomShape, pos?: {x: number; y: number}) => {
    pushHistory();
    tickTask('node');
    // §6.5 step 2 — SNAP TO THE GRID, unconditionally: the drop point is the
    // only thing that decides where this lands, so it is the thing quantised.
    /* AUDIT-7 — wrap-centre as a CLIENT coord (see the favourite twin above). */
    const wr2 = wrap.current?.getBoundingClientRect();
    const raw = pos ?? (rf && wr2
      ? rf.screenToFlowPosition({x: wr2.left + wr2.width / 2, y: wr2.top + wr2.height / 2})
      : {x: 480, y: 300});
    let p = {x: Math.round(raw.x / gridSize) * gridSize, y: Math.round(raw.y / gridSize) * gridSize};
    // AQ19 — centre the custom shape under the cursor (its own size is known).
    p = {x: Math.round(p.x - shape.w / 2), y: Math.round(p.y - shape.h / 2)};
    // §6.5 step 3 — RE-GENERATE THE ID. Never a stored one.
    const id = `n${idc++}`;
    setNodes(ns => [...ns, {
      id,
      type: 'customshape',
      position: p,
      selected: false,
      // §8.3 — the size came from `clampShapeSize` at import, so it is already
      // quantised and inside 32–512; since ROUND BE (2026-10-23) the live
      // resizer carries only the 32px floor — no ceiling, like every goblin node.
      style: {width: shape.w, height: shape.h},
      data: {svg: shape.data, viewBox: shape.viewBox, title: shape.title, colorKey: shape.colorKey},
    } as Node]);
  }, [gridSize, pushHistory, setNodes, rf, tickTask]);

  /** The ONE way `shapes` changes: a PURE updater, then a persist — the same
   *  contract as `mutateFavourites`, for the same StrictMode reason. The write
   *  is deferred past the commit and reads the committed list from `shapesRef`;
   *  it sends the CURRENT favourites with it, so the two halves of the library
   *  document are never written apart. */
  const mutateShapes = useCallback(
    (updater: (prev: CustomShape[]) => CustomShape[]) => {
      /* The ref is advanced SYNCHRONOUSLY, before `setState` — see the
         measured race documented on `persistLibrary`. The import path resumes
         from `await file.text()`, so reading the ref at write time would read
         the PRE-import list. Computing `next` here and passing it makes the
         write independent of when React commits. */
      const next = updater(shapesRef.current);
      shapesRef.current = next;
      setShapes(next);
      window.setTimeout(() => { void persistLibrary(favouritesRef.current, next); }, 0);
    },
    [persistLibrary],
  );

  /** §8.1 — drop an imported shape from the library, then persist.
   *
   *  IDENTITY NOTE: a `CustomShape` has NO id field (the spec's §8.1 store is
   *  `{title, tags, data, w, h, aspect, colorKey, viewBox, sanitizer,
   *  sanitizedAt, created}`). `created` is the epoch-ms stamp taken once at
   *  import, which makes it the entry's stable, unique identity; the `title`
   *  is also accepted so a caller holding only a label can still remove it. */
  const removeCustomShape = useCallback((id: string) => {
    const matches = (s: CustomShape) => String(s.created) === id || s.title === id;
    if (!shapesRef.current.some(matches)) return;   // nothing to remove, nothing to persist
    mutateShapes(prev => prev.filter(s => !matches(s)));
  }, [mutateShapes]);

  /* =====================================================================
     PACKAGE-N §8.1–§8.3 pass 4c — the IMPORT UI.

     One file → one stored shape, and ONE path does it (`importShapeFile`): the
     hidden picker, the drop zone in the panel and a file dropped on the canvas
     all funnel through it, so all three gate, parse and report identically.
     ===================================================================== */

  /** The hidden `<input type=file>`; `display:none` inputs can only be opened
   *  programmatically, so every "import" affordance clicks this one node. */
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const openShapeImport = useCallback(() => { importInputRef.current?.click(); }, []);

  /** §8.1 — the one place a `File` becomes a stored shape.
   *
   *  ORDER MATTERS: the type gate comes first. A PNG is not an oversized SVG,
   *  it is the wrong kind of file, and answering it with the size limit would
   *  send the user off editing dimensions that were never the problem. The
   *  size gate is then measured on the `File` itself, so a 40 MB file is
   *  rejected without ever being read into memory. */
  const importShapeFile = useCallback(async (file: File) => {
    const name = file.name || '';
    if (!/\.svg$/i.test(name) && file.type !== 'image/svg+xml') {
      flash('Only .svg files can be imported.');
      return;
    }
    if (file.size > SHAPE_MAX_INPUT_BYTES) {
      flash(SHAPE_REJECT_MESSAGE['too-large']);
      return;
    }
    let raw: string;
    try {
      raw = await file.text();
    } catch {
      flash("Couldn't read that file.");
      return;
    }
    // §8.1 — naming is OPTIONAL (settled): the file's own name is the title,
    // minus the extension, with a neutral fallback. No prompt, ever.
    const title = name.replace(/\.svg$/i, '').trim() || 'Imported shape';
    const res = newCustomShape({raw, title, colorKey: 'cyan', gridSize});
    // The `'reason' in` discriminant is the idiom `customShape.ts` itself uses
    // (see `newCustomShape`); a rejection is ALWAYS reported, because the toast
    // is the only feedback there is — silence would look like a dead button.
    if ('reason' in res) {
      flash(SHAPE_REJECT_MESSAGE[res.reason]);
      return;
    }
    const shape = res.shape;
    // Prepend: the newest import is the one the user is about to place.
    mutateShapes(prev => [shape, ...prev]);
    flash(`Imported “${shape.title}”.`);
  }, [flash, gridSize, mutateShapes]);

  const onImportInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared BEFORE the read: choosing the same file twice must fire `change`
    // twice, and a retained value silently swallows the second pick.
    e.target.value = '';
    if (file) void importShapeFile(file);
  }, [importShapeFile]);

  /** Resolve a dragged custom-shape payload — the sanitised markup itself —
   *  back to its stored entry, then insert it at `pos`.
   *
   *  IDENTITY: the payload carries no id (a `CustomShape` has none), and the
   *  markup is exactly what the library holds, so matching on `data` is exact.
   *  Read through the ref so this stays a stable callback. */
  const dropCustomShape = useCallback((payload: string, pos?: {x: number; y: number}) => {
    const found = shapesRef.current.find(s => s.data === payload);
    if (found) insertCustomShape(found, pos);
  }, [insertCustomShape]);

  /** The `DataTransfer` type list, normalised — `types` is a `DOMStringList`
   *  in older DOM libs and a readonly array in newer ones, so it is copied
   *  into a plain array and both shapes work. */
  const dragTypes = (e: React.DragEvent): string[] => {
    const t = e.dataTransfer?.types;
    return t ? Array.from(t as ArrayLike<string>) : [];
  };

  /** The panel drop zone's own drop path. It cannot be omitted: the zone lives
   *  in the left panel, and `main` (which owns the canvas drop) is a SIBLING,
   *  so a file dropped there bubbles to no handler at all. It is wired through
   *  `shapeZoneProps` below rather than a second JSX drop attribute, keeping
   *  the canvas `onDrop` the single drop path in this file. */
  const onShapeZoneDragOver = useCallback((e: React.DragEvent) => {
    // Claim the event ONLY when it carries OS files — an ordinary node drag
    // passing over the panel must not be treated as an import.
    if (dragTypes(e).includes('Files')) e.preventDefault();
  }, []);

  const onShapeZoneDrop = useCallback((e: React.DragEvent) => {
    if (!dragTypes(e).includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) void importShapeFile(file);
  }, [importShapeFile]);

  const shapeZoneProps = {onDragOver: onShapeZoneDragOver, onDrop: onShapeZoneDrop};

  // ---- drag & drop from palette ----
  const onDrop = useCallback((e: React.DragEvent) => {
    // A file dropped anywhere on the canvas is an IMPORT (§8.1), not a node
    // placement — same path as the picker.
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && (!e.dataTransfer.types || dragTypes(e).includes('Files'))) {
      e.preventDefault();
      void importShapeFile(droppedFile);
      return;
    }
    e.preventDefault();
    if (!rf || !wrap.current) return;
    const favId = e.dataTransfer.getData('favourite');
    const label = e.dataTransfer.getData('palette');
    const cust = e.dataTransfer.getData('customshape');
    if (!favId && !label && !cust) return;
    /* AQ18 — raw client coords: screenToFlowPosition subtracts the pane rect
       itself; the extra `- b.left/- b.top` double-subtracted the wrap offset
       and every palette drop landed up-left of the cursor (same defect AUDIT-7
       fixed for the ctx-menu path — this sibling was missed). */
    const p = rf.screenToFlowPosition({x: e.clientX, y: e.clientY});
    // §6.5 — a favourite drop re-derives the geometry at the drop point; the
    // payload carried only the favourite's ID, never a stored coordinate.
    if (cust) {
      // The custom-shape payload IS the sanitised markup: it carries no id,
      // and the store holds exactly this string, so it resolves back exactly.
      dropCustomShape(cust, p);
      return;
    }
    if (favId) {
      const fav = favourites.find(f => f.id === favId);
      if (fav) insertFavourite(fav, p);
      return;
    }
    addNodeByLabel(label, p);
  }, [rf, favourites, insertFavourite, dropCustomShape, importShapeFile]);

  // ---- record history on destructive changes only ----
  // Node and edge removals arrive as separate callbacks for one Del press,
  // so a short guard merges them into a single history entry.
  const removeGuard = useRef(false);
  const noteRemove = useCallback(() => {
    if (removeGuard.current) return;
    removeGuard.current = true;
    window.setTimeout(() => { removeGuard.current = false; }, 0);
    pushHistory();
  }, [pushHistory]);

  /* ROUND 5 — A RESIZE IS ONE UNDOABLE STEP. Same shape as the drag, which
     pushes once from `onNodeDragStartAll` (below). React Flow's `NodeResizer`
     emits a `dimensions` change carrying `resizing: true` on every frame of the
     drag and a final `resizing: false` at the end; `recordResizeGesture` turns
     that stream into exactly one push and re-arms for the next gesture. The
     decision itself lives in `src/resizeHistory.ts` so `checks/` can execute it
     rather than restate it. See that file for why the change-level flag is used
     instead of `onResizeStart`, and why position changes are NOT recorded here.
     `guard` is a plain object (not a boolean ref) because the helper needs to
     write back through it. */
  const resizeGuard = useRef(newResizeGuard());

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    if (changes.some(c => c.type === 'remove')) noteRemove();
    if (recordResizeGesture(resizeGuard.current, changes)) pushHistory();
    onNodesChange(changes);
  }, [onNodesChange, noteRemove, pushHistory]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some(c => c.type === 'remove')) noteRemove();
    onEdgesChange(changes);
  }, [onEdgesChange, noteRemove]);


  // Part B — ONE source of truth for the read-only review toggle. The toolbar
  // button and the Shift+2 shortcut both call this, so the two triggers can
  // never drift apart. The body is the button's original inline onClick,
  // carried across verbatim; the deps list every value it reads (`readOnly`,
  // `rf`) and every setter it calls, so neither path can close over a stale
  // `readOnly` and flip the mode the wrong way.
  const toggleReadOnly = useCallback(() => {
    /* GOBI-SHARE-LOCK — a share view cannot be unlocked from inside: the
       toggle is disabled and Shift+2 lands here only via the keyboard path,
       which must be inert too ("Copy to my boards" is the ONE exit). The ref (not
       the state) decides so an in-flight keydown during the share decode is
       also covered. */
    if (shareActive.current) return;
    const next = !readOnly;
    setReadOnly(next);
    readOnlyRef.current = next; /* AUDIT-16 — visible to in-flight gestures immediately */
    try { localStorage.setItem(READ_ONLY_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    if (next) {
      // Entering the mode must not leave a stale ring or node
      // toolbar on screen: `elementsSelectable={false}` only stops
      // FUTURE selections, it does not clear an existing one — and
      // the node toolbar / resize handles render off `selected`.
      setCtx(null);
      setSearchPos(null);
      if (rf) {
        rf.setNodes(nss => nss.map(n => n.selected ? {...n, selected: false} : n));
        rf.setEdges(es => es.map(e2 => e2.selected ? {...e2, selected: false} : e2));
      }
      setSel(null);
      setSelEdgeId(null);
      setSelCount(0);
      flash('Read-only review mode');
    } else {
      flash('Editing enabled');
    }
  }, [readOnly, rf, flash, setCtx, setSearchPos, setSel, setSelEdgeId, setSelCount, shareActive]);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      // M / §3.3: while the Settings dialog is open the app's shortcuts are
      // inert — no bare d/z/? and no arrow-nudge while the user tabs the nav.
      // (The dialog's own capture listener owns Escape; see the branch below.)
      if (settingsOpen) return;
      // ITEM 6b: the board dialog owns the keyboard too, and this return is
      // DELIBERATELY HERE — above the Escape branch below, not in the overlay
      // guard after it. The board MENU is handled down there because Escape is
      // the way out of a menu and the branch below is what closes it. The dialog
      // is different: its own capture listener owns Escape (cancel) and Tab
      // (the trap), so if this returned further down, Escape would ALSO reach the
      // branch below and deselect every node on the canvas behind the dialog —
      // the dialog would close and the user's selection would silently vanish.
      // `isEditable(e.target)` above covers the name field, so typing is never
      // swallowed; this line only stops the app's shortcuts landing behind it.
      if (boardDlg) return;
      /* PACKAGE-TEMPLATES §2.5 Pass 2 — the gallery owns the keyboard while it is
         up, in the SAME guard as every other overlay and for the same reason.
         It sits directly BELOW `boardDlg`: the two are independent, so with both
         open (the gallery opened from the dialog's trailing row) the app is inert
         behind them. The gallery's own capture listener owns Escape, so Escape
         never reaches the branch below and cannot deselect the canvas behind two
         scrims. */
      if (tgOpen) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      // D3: Escape clears node + edge selection and closes any open popovers.
      // It is handled FIRST, before the overlay guard below, on purpose: Escape
      // is the way OUT of every surface that guard protects. Move it after and
      // Escape stops closing search → help → boards.
      if (e.key === 'Escape') {
        // M: Settings closes first — before search → help → boards → clear.
        if (settingsOpen) { setSettingsOpen(false); return; }
        if (searchPos) { setSearchPos(null); return; }
        if (help) { setHelp(false); return; }
        if (boardsOpen) { setBoardsOpen(false); return; }
        if (rf) {
          rf.setNodes(ns => ns.map(n => n.selected ? {...n, selected: false} : n));
          rf.setEdges(es => es.map(e2 => e2.selected ? {...e2, selected: false} : e2));
        }
        return;
      }
      // H1: every other overlay on screen owns the keyboard. While the onboarding
      // tour, the help popover, a board menu or the insert palette is open, an
      // app shortcut must not fire behind it — a stray ⌘Z during the tour would
      // undo the newcomer's own work, and `?` would stack the cheat sheet on top
      // of a surface that is already being read. The tour handles its own
      // Arrow/Enter/Escape in a CAPTURE listener that stops propagation
      // (Tour.tsx), so those keys never arrive here and keep working.
      if (tourOpen || help || boardsOpen || searchPos) return;
      // Shift+1 (physical Digit1) — "fit view", the Figma/Excalidraw/Miro
      // convention. It carries a modifier, so it is legal under this app's
      // no-bare-key rule. Matched on `e.code`, NOT `e.key`: on most layouts
      // Shift+1 delivers `!` as the key, so a key-based match would break.
      // The overlay guard above and the `isEditable(e.target)` early-return at
      // the top of this handler keep typing (and open overlays) safe.
      if (e.shiftKey && e.code === 'Digit1' && !mod) {
        e.preventDefault();
        rf?.fitView({padding: 0.25});
        return;
      }
      // Shift+2 (physical Digit2) — toggle the read-only review mode. Same
      // convention as Shift+1: it carries a modifier, so it is legal under this
      // app's no-bare-key rule, and it is matched on `e.code`, NOT `e.key` —
      // Shift+2 delivers `@` as the key on most layouts, so a key-based match
      // would break.
      // PLACEMENT IS LOAD-BEARING: this branch sits ABOVE the `if (readOnly)`
      // early-return a few lines below. The mode must be enterable AND
      // leavable by the same key, so the shortcut has to be reached before the
      // handler starts swallowing everything. Move it below that return and the
      // shortcut becomes one-way: it can switch the mode ON and then never OFF.
      // It also deliberately sits after the overlay guard above, so a stray
      // Shift+2 cannot flip the mode behind the tour, help, a board menu or the
      // insert palette.
      if (e.shiftKey && e.code === 'Digit2' && !mod) {
        e.preventDefault();
        toggleReadOnly();
        return;
      }
      // ---- Part B: read-only review mode owns no mutation --------------------
      // Placed HERE on purpose — after `isEditable`, after the Settings guard,
      // after Escape (the way out of every overlay) and after Shift+1, so those
      // three keep working: they change the VIEWPORT or close a surface, never
      // the board. Everything below this point mutates, so in review mode the
      // handler returns before reaching it: undo, redo, copy, paste, duplicate,
      // the panel-visibility chord, arrow-nudge and the `/` panel-search focus
      // are all inert. `?` (the cheat sheet) is a pure read surface and is
      // explicitly kept available.
      if (readOnly) {
        if (k === '?') { setHelp(h => !h); return; }
        return;
      }
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      /* ROUND ROTATE — Alt+R / Alt+Shift+R = ±15° on the selection (single
         node: its own delta; multi: each member keeps its own delta while
         its centre orbits the selection centroid — ONE undo entry, the
         useRotation chord writer). Matched on e.code (Shift rewrites the
         delivered character), never `mod` — Alt alone, so the browser's
         own menu-focus chords are not stolen. */
      if (e.altKey && !mod && e.code === 'KeyR') {
        e.preventDefault();
        rotateSelection(e.shiftKey ? -ROTATE_SNAP_DEG : ROTATE_SNAP_DEG);
        return;
      }
      if (mod && k === 'c') { copySelection(); return; }
      if (mod && k === 'v') { e.preventDefault(); pasteClipboard(40); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
      // ---- PACKAGE-Q: panel chrome — three chords, ONE writer each ----------
      //   Cmd+Ctrl+Shift+backslash → hide BOTH docked panels if either one is on
      //                              screen, else show BOTH (the Figma group
      //                              toggle, unchanged; a single panel is still
      //                              reachable from its own edge chevron)
      //   Cmd+Ctrl+Shift+[         → toggle the LEFT panel only
      //   Cmd+Ctrl+Shift+]         → toggle the RIGHT panel only
      //
      // THE GROUP CHORD GAINED A MODIFIER. It used to be one modifier plus
      // Shift; on macOS the user asked for Cmd AND Ctrl together. `mod` above is
      // meta-OR-ctrl, so it cannot express a two-modifier chord — the real
      // modifier PAIR is tested below instead, per platform.
      //
      // MATCHED ON `e.code`, NEVER on the `k` string read above. All three
      // chords carry Shift, and Shift rewrites the character a key delivers, so
      // a character match against the bracket glyph would never fire. This is
      // the same trap Shift+1 / Shift+2 higher up avoid by matching the physical
      // Digit1 / Digit2 keys.
      //
      // PLACEMENT IS LOAD-BEARING and unchanged from the binding this replaces:
      // these branches sit BELOW the read-only early-return above (panel
      // visibility is a persisted layout mutation, so review mode must swallow
      // them exactly as it swallowed the chord before) and BELOW the overlay
      // guard, so a stray chord cannot flip panels behind the tour, help, a
      // board menu or the insert palette. They sit ABOVE the arrow-nudge, `?`
      // and `/` branches, which they shadow.
      //
      // The VISIBLE-state read stays the `hiddenRef` one that made the M3/S2c
      // desync unreachable: the old code derived `next` from the raw collapse
      // flags, so a left-only collapse wrote both sides as hidden for a right
      // panel that was already hidden and the press changed nothing the eye
      // could see. ONE atomic `setPanelsVisible` write of both sides is the fix;
      // do not reintroduce a second path.
      //
      // NON-MAC: there is no Cmd key, so the group chord keeps the form this app
      // already shipped on Windows/Linux — Ctrl+Shift — and the two per-side
      // chords mirror onto the bracket keys. Documented in Settings → Shortcuts
      // and README so the documentation matches the code.
      const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
      const panelChord = mac ? (e.metaKey && e.ctrlKey && e.shiftKey) : (e.ctrlKey && e.shiftKey);
      if (panelChord && e.code === 'Backslash') {
        e.preventDefault();
        const {left, right} = hiddenRef.current;
        // any panel visible → hide both; none visible → show both
        setPanelsVisible(left && right);
        return;
      }
      if (panelChord && e.code === 'BracketLeft') {
        e.preventDefault();
        togglePanel('left');
        return;
      }
      if (panelChord && e.code === 'BracketRight') {
        e.preventDefault();
        togglePanel('right');
        return;
      }
      // arrow keys nudge the selection: 1px, Shift+arrow 10px
      if (k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown') {
        const step = e.shiftKey ? 10 : 1;
        const selAny = nodesRef.current.some(n => n.selected);
        if (!selAny) return;
        e.preventDefault();
        if (k === 'arrowleft') nudge(-step, 0);
        else if (k === 'arrowright') nudge(step, 0);
        else if (k === 'arrowup') nudge(0, -step);
        else nudge(0, step);
        return;
      }
      // D3: Escape clears node + edge selection and closes any open popovers
      // (handled above, before the overlay guard — Escape must stay the way out).
      if (k === '?') { setHelp(h => !h); return; }
      // ---- PACKAGE-N 2c: `/` focuses the panel's shape search --------------
      // draw.io's convention. Three guards, all required:
      //   * `mod` — a bare `/` only. Mod+/ is left for a future binding and is
      //     not stolen from the browser (Cmd+/ is a real shortcut elsewhere).
      //   * the overlay guard ABOVE already returned while the tour, help, the
      //     board menu or the insert modal is up, so `/` cannot focus a field
      //     behind a dialog.
      //   * `isEditable(e.target)` at the top of this handler means `/` typed
      //     INTO a field (including this one) can never re-trigger — which is
      //     what keeps the shortcut from fighting the handler. No `preventDefault`
      //     is needed to swallow the character: we focus the field, so the `/`
      //     never reaches anything that would render it.
      if (k === '/' && !mod && !isEditable(e.target) && isPanelVisible('left')) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, copySelection, pasteClipboard, duplicateSelection, nudge, rf, searchPos, help, boardsOpen, settingsOpen,
      setPanelsVisible, tourOpen, readOnly, toggleReadOnly, boardDlg, tgOpen]);

  // ---- C5: live zoom level for the zoom pill ----
  const ZoomPill = () => {
    const z = useStore(s => s.transform[2]);
    return (
      <Tooltip label="Reset zoom to 100%">
        <button
          type="button"
          className="zoom-pill"
          aria-label="Reset zoom to 100%"
          onClick={() => rf?.zoomTo(1)}
        >
          {Math.round(z * 100)}%
        </button>
      </Tooltip>
    );
  };

  // ---- I4: reliable cross-browser download (Safari on LAN blocks downloads
  // from a detached anchor with a giant data:/blob: URL). Use a Blob + object
  // URL, attach the anchor to the DOM, click it, then clean up on a timeout.
  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 4000); // give Safari time to start the download before revoking
  };

  /* ROUND BN-2 — the export cluster now lives in useExportActions.ts
     (moved verbatim; the lazy thunks moved with it and stay DYNAMIC inside
     the hook). The Mermaid import mints ids through readNextId/setNextId
     because App owns the module-level idc counter. */
  const [buildSvg, buildPng, boardPngForFeedback, printPdf, fileRef] = useExportActions(
    wrap, rf, theme, nodes, edges, pngScale, pngPad, curBoard,
    pushHistory, setNodes, setEdges, bumpHist, flash, tickTask,
    () => idc, (n: number) => { idc = n; });


  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const okNodes = Array.isArray(parsed?.nodes) && parsed.nodes.every((n: {id?: string; type?: string; position?: {x: number; y: number}}) =>
        n && typeof n.id === 'string' && n.position &&
        typeof n.position.x === 'number' && typeof n.position.y === 'number');
      const okEdges = Array.isArray(parsed?.edges) && parsed.edges.every((ed: {id?: string; source?: string; target?: string}) =>
        ed && typeof ed.id === 'string' && typeof ed.source === 'string' && typeof ed.target === 'string');
      if (!okNodes || !okEdges) {
        flash('Import failed: invalid diagram JSON');
        return;
      }
      // keep generated ids ahead of anything imported
      let maxId = idc;
      for (const n of parsed.nodes as Node[]) {
        const m = /^n(\d+)$/.exec(n.id);
        if (m) maxId = Math.max(maxId, Number(m[1]) + 1);
      }
      idc = maxId;
      // importing resets the history to the imported state.
      // Legacy files carry no edge type — normalise so old edges stay editable.
      const importedEdges: Edge[] = (parsed.edges as Edge[]).map(ed => ({
        ...ed,
        type: isGoblinEdge(ed.type) ? ed.type : 'goblinEdge',
        data: {...((ed.data ?? {}) as EdgeData)},
      }));
      past.current = [];
      future.current = [];
      setNodes(parsed.nodes);
      setEdges(importedEdges);
      bumpHist(v => v + 1);
      // Import replaces the CURRENT board's content (or seeds a new board when
      // none is open) — it does not create a separate board.
      if (curBoard) {
        setCurBoard(c => c ? {...c, nodes: parsed.nodes, edges: importedEdges} : c);
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => { void flushSave(); }, 30);
        setNotice(`Imported ${parsed.nodes.length} nodes · ${parsed.edges.length} edges into “${curBoard.name}”`);
      } else {
        setNotice(`Imported ${parsed.nodes.length} nodes · ${parsed.edges.length} edges`);
      }
      setTimeout(() => setNotice(''), 2500);
      /* HARVEY 2026-10-13 — maxZoom 1, same as the board-load fit. */
      setTimeout(() => rf?.fitView({padding: 0.25, maxZoom: 1}), 30);
    } catch {
      flash('Import failed: could not parse JSON');
    }
  };

  const sep = () => <span style={{width: 1, height: 18, background: 'var(--border)', flex: 'none'}} />;

  // ---- selected-edge derived values (toolbar + inspector) ----
  const eStroke = selectedEdge ? edgeStroke(selectedEdge) : COLOR_VAR.accent;
  const eStrokeKey = edgeStrokeKey(selectedEdge);
  const eDash = (selectedEdge?.style as any)?.strokeDasharray
    ? (String((selectedEdge!.style as any).strokeDasharray).startsWith('1') ? 'dotted' : 'dashed')
    : 'solid';
  const eWidth = String((selectedEdge?.style as any)?.strokeWidth ?? 1.8);
  const eMarkerEnd = ((selectedEdge?.markerEnd as any)?.type as string) ?? 'none';
  const eMarkerStart = ((selectedEdge?.markerStart as any)?.type as string) ?? 'none';
  const eFlow = (((selectedEdge?.data as any)?.flow ?? 'none') as string);
  const eFlowCount = (((selectedEdge?.data as any)?.flowCount ?? 3) as number);
  const eFlowSpeed = (((selectedEdge?.data as any)?.flowDuration ?? 2.4) as number);
  const eFlowIcon = (((selectedEdge?.data as any)?.flowIcon ?? 'mail') as string);
  const ePathType = (Object.keys(PATH_TYPES) as PathType[]).find(k => PATH_TYPES[k] === selectedEdge?.type && k !== 'custom') ?? 'bezier';
  /* ROUND AK, AK-12 — the label plate's readout, TOLERANT of an unknown value
     (`labelBgOf` resolves anything unrecognised to `surface`, the shipped look),
     so a hand-edited board cannot render an unstyled plate. */
  const eLabelBg = labelBgOf((selectedEdge?.data as any)?.labelBg);
  /* AL-3 — the label's two NEW colour keys, read through the SAME resolver the
   *  edge stroke uses (`isColorKey` + `COLOR_VAR`), so both rows draw from the
   *  panel's existing 9-key vocabulary and neither invents a palette. `null`
   *  means \"not set\", which is what makes the swatch row show an unselected
   *  state rather than a false default. */
  const eLabelTextKey = resolveColorKey({strokeKey: (selectedEdge?.data as any)?.labelTextKey} as any);
  const eLabelBgKey = resolveColorKey({strokeKey: (selectedEdge?.data as any)?.labelBgKey} as any);
  /* AK-14.1 — `Reset label position` is only meaningful once the label has
     actually been moved, so the button is disabled on a centred label rather
     than offering a step that would push a history entry and change nothing. */
  const eLabelMoved = !!(selectedEdge?.data as any)?.labelPinned;
  /* ROUND AK, AK-3 — `eOffset` WAS HERE, and it is deleted with the field it
     fed. It was the `data.offset` readout for the `label position` row; with that
     row gone nothing reads it. The VALUE is untouched — `GoblinEdge.tsx:383`
     still reads `d.offset` — so a board carrying `start`/`end` still renders it. */

  /* NOTE, reported rather than fixed in passing: `markerOptions` below is DEAD
     (it is defined and never read — checked by grep). It was ALREADY dead before
     this pass (the PACKAGE-P picker conversion replaced its one consumer with
     `MARKER_OPTS`), so it is not this pass's to remove and it is left byte-for-byte
     as found. Flagged here so the next pass does not mistake it for a regression. */
  const markerOptions = [
    {v: 'none', label: 'None'},
    {v: MarkerType.ArrowClosed, label: 'Arrow (closed)'},
    {v: MarkerType.Arrow, label: 'Open arrow'},
  ];

  /* ---- PACKAGE-P §B: the option tables the pickers render ----------------
     Each table is the SAME value set the `<select>` it replaces carried, so the
     conversion changes the control and nothing about what is stored. `art` is
     the glyph; `label` is both the trigger text and the row text. */
  const MARKER_OPTS: PickerOption[] = [
    {v: 'none', label: 'none', art: <ArtArrow kind="none" />},
    {v: MarkerType.ArrowClosed, label: 'closed arrow', art: <ArtArrow kind="closed" />},
    {v: MarkerType.Arrow, label: 'open arrow', art: <ArtArrow kind="open" />},
  ];
  /** same table, mirrored — the head-START control is the head-END one flipped. */
  const MARKER_OPTS_START: PickerOption[] = [
    {v: 'none', label: 'none', art: <ArtArrow kind="none" flip />},
    {v: MarkerType.ArrowClosed, label: 'closed arrow', art: <ArtArrow kind="closed" flip />},
    {v: MarkerType.Arrow, label: 'open arrow', art: <ArtArrow kind="open" flip />},
  ];
  const WIDTH_OPTS: PickerOption[] = [1, 1.5, 1.8, 2, 3].map(w => ({
    v: String(w), label: String(w), art: <ArtWidth w={w} />,
  }));
  const DASH_OPTS: PickerOption[] = (['solid', 'dashed', 'dotted'] as const).map(d => ({
    v: d, label: d, art: <ArtDash kind={d} />,
  }));
  const CURVE_OPTS: PickerOption[] = (['bezier', 'smoothstep', 'step', 'straight'] as const).map(c => ({
    v: c, label: c, art: <ArtCurve kind={c} />,
  }));
  /* ROUND AK, AK-3 — `OFFSET_OPTS` WAS HERE, AND IT IS DELETED, with the
   *  `ArtLabelPos` glyph it drew (that glyph had no other consumer). The table
   *  backed the `label position` row — a 3-button preset for a value the label
   *  drag already sets — so it went with the row. THE STORED FIELD IS UNTOUCHED:
   *  `data.offset` is still read by `GoblinEdge.tsx:383`, so a board that
   *  carries `start`/`end` renders exactly as it did. */
  /* ROUND AM, AM-5 — `SPEED_OPTS` IS DELETED, AND SO IS THE ROW IT FED.
     It held four ordinal words — `slow` / `normal` / `fast` / `very fast` — over
     `flowDuration`, a value the renderer accepts continuously (0.6…8s). Four
     hard steps were COARSER than the field they wrote, and the row cost a full
     50px of panel for them. The flow section now renders `FlowSpeed`: a range
     input on the field's own range, so the four old values (4 / 2.4 / 1.4 / 0.8)
     are all still reachable and everything between them is too.
     NOTHING IS STORED DIFFERENTLY: the write is still
     `updateEdge({data: {flowDuration: …}})`, so a board carrying any of the four
     renders exactly as it did. The table is not kept "just in case" — a removed
     option that keeps its table is how the option comes back. */
  /* ROUND AK, AK-12 — THE LABEL PLATE'S THREE STATES. `LABEL_BG_VALUES` is the
     canonical list (it is what the renderer's `labelBgClass` resolves against),
     and each entry's label is its own name capitalised, so the stored value and
     the button text cannot drift apart. Three options ≤ the cited flat-row
     threshold of 4 (AK-6 note), so this is a segmented row like the rest.
     `None` is a GENUINE STORED VALUE here, not the absence of one — which is why
     the table lists it rather than leaving the row with two entries and a
     "default" the user cannot return to. */
  const LABEL_BG_OPTS: PickerOption[] = LABEL_BG_VALUES.map(v => ({
    v, label: v === 'none' ? 'None' : v === 'surface' ? 'Surface' : 'Outline', art: null,
  }));

  /* ==========================================================================
     ROUND AL, AL-6 — THE ONE CHIP ROW. This is the panel's ONLY row control.

     WHY ONE HELPER, AND WHY A REAL `<button>`. The owner measured three
     unrelated button families on one panel (`"lúc to, lúc dài, lúc nhỏ"`); a
     single helper is what makes that impossible to reintroduce — there is no
     second place to add a button. The element is a native
     `<button type="button">`, so Enter and Space work with NO key handler
     (the same rule this project set for the section trigger), and the class
     `chip` carries the figure: a PILL by default, `chip ic` for a glyph row
     (the square), `chip act` for an action.

     SIZE IS THE CONTENT'S. The row wraps (`styles.css` `.chips`) and no chip
     carries `flex: 1 1 0`, so "None" is short and "Reset label position" is
     long and each is the width it needs — the exact inverse of the equal-share
     grid the owner measured as uneven. */
  const chipRow = (opts: PickerOption[], value: string, onPick: (v: string) => void, title: string, glyph = false) => (
    <div className="chips">
      {opts.map(o => (
        <button
          key={o.v}
          type="button"
          className={`chip${glyph ? ' ic' : ''}${String(o.v) === value ? ' on' : ''}`}
          title={o.label ? `${title}: ${o.label}` : title}
          onClick={() => onPick(String(o.v))}
        >
          {glyph ? (o.art ?? o.label) : o.label}
        </button>
      ))}
    </div>
  );
  /** AL-6 — the GLYPH variants of the four tables converted this round. They are
   *  the SAME tables (same values, same writes) — only the row's figure changes,
   *  so a value can never differ between the pill form and the glyph form. */
  const DASH_ICON_OPTS = DASH_OPTS;
  const CURVE_ICON_OPTS = CURVE_OPTS;
  const MARKER_ICON_OPTS = MARKER_OPTS;
  const MARKER_ICON_OPTS_START = MARKER_OPTS_START;
  /** AL-6 — `flow` becomes a GLYPH row. `flow glyph` reuses `FLOW_ICON_PATHS`'s
   *  own vocabulary rather than inventing a second one. */
  const FLOW_OPTS: PickerOption[] = ([
    ['none', 'None'], ['dots', 'Dots'], ['dash', 'Dash'], ['pulse', 'Pulse'], ['icon', 'Icon'],
  ] as const).map(([v, label]) => ({v, label, art: <ArtFlow kind={v} />}));
  /** ROUND AM, AM-3 — `flow glyph` becomes a row of SIX ICON CHIPS carrying the
   *  glyph each option will actually travel along the line, drawn in miniature,
   *  exactly as the approved mockup draws them. Two things had to change for
   *  that to be honest rather than a second vocabulary:
   *
   *  1. `art` is no longer `null`. It was the whole reason the row rendered as
   *     word-chips: `chipRow`'s glyph form falls back to `o.label`, so six
   *     `art: null` options painted six words. Each now carries its own glyph.
   *  2. The glyphs come from `FLOW_ICON_PATHS` — moved to `src/nodes/flowIcons.tsx`
   *     (AM-3) so BOTH readers can reach it. AL-6's comment claimed this reuse;
   *     the module boundary made it a promise. This file and `GoblinEdge.tsx`
   *     now read the SAME map, so a chip cannot drift from the picture the edge
   *     travels.
   /* ROUND AN, AN-3 — THE GLYPH ROW DRAWS IN THE FLOW ROW'S OWN FRAME.
      This row used to carry its own `<svg viewBox="0 0 24 24" width={15}
      height={15}>`: a figure of ~12.5px of ink inside a 15px box, rendered at the
      same 30×30 chip. Every figure in the `flow` row directly above it instead
      goes through the shared `G` wrapper — a 26×18 viewBox with a `2` stroke, so
      its ink spans roughly 22×10 OF THAT BOX. Two frames, two weights, same chip
      size: that is the owner's report ("làm cái icon nó to như mấy cái nút như
      trong flow cho đồng bộ kích thước"). The frame, the stroke and the classes
      are now IDENTICAL to `ArtFlow`'s, so the two rows are one family by
      construction rather than by two lookalike implementations.

      THE GLYPH PATHS DID NOT CHANGE, and they are not copied either. The six
      figures arrive from `FLOW_ICON_PATHS` — the map AM-3 moved into
      `src/nodes/flowIcons.tsx` so this row and the travelling chip could not drift — and
      are SCALED INSIDE the shared frame instead of being re-drawn for it. The
      scale is read off the two geometries rather than guessed, and the rendered
      pixel arithmetic is stated so the number can be checked:

        · `ArtFlow`'s figures run from x=2 to x=24 — 22 UNITS of the 26-unit frame,
          which is the span the flow row's ink occupies.
        · These glyphs are drawn on a 24×24 grid whose own ink spans 2..22 — 20
          UNITS (checked across all six: `mail`'s rect is 2..22, `settings`' spokes
          reach 2..22, the rest sit inside that).
        · So the factor is frame-span ÷ glyph-span = 22/20, NOT 22/24: dividing by
          the glyph's GRID instead of its INK would shrink each figure to 18.3
          frame units — smaller than the row above it, i.e. the defect in reverse.
        · `stroke-width` is divided by that same factor, so what the browser paints
          is the same TWO FRAME UNITS `ArtFlow` paints. Scaling a stroke without
          this division is how a glyph ends up thinner at the same nominal width.

      THE RENDERED RESULT, from source: `.chip svg` (`styles.css`) sizes BOTH rows'
      `<svg>` to 15×15, so a frame unit is 15/26 = 0.577px in each. Both rows'
      figures therefore land on 22 × 0.577 = 12.7px with a 2 × 0.577 = 1.15px
      stroke. Before this item the glyph row was a 24-unit grid in the same 15px
      box (0.625px per unit), i.e. a 12.5px figure with a 1.25px stroke: the two
      rows were NEAR-EQUAL BY COINCIDENCE of two different frames and two
      different strokes. They are now equal by construction — one frame, one
      painted stroke — which is the parity the owner asked for and the reason the
      fix is a frame change rather than a size tweak.

      THE CHIP BOX STAYS 30×30 (`.chip.ic`): the complaint is the FIGURE's weight,
      not the button's size, so no rule was enlarged. The row still wraps on its
      own — `.chips` is `flex-wrap: wrap` and this row is that class — so six chips
      that no longer fit drop to a second line without a new rule. */
      const FLOW_GLYPH_SCALE = 22 / 20;
   const FLOW_ICON_OPTS: PickerOption[] = (([
     ['mail', 'Letter'], ['package', 'Package'], ['file', 'File'],
     ['zap', 'Zap'], ['settings', 'Gear'], ['database', 'DB'],
   ] as const)).map(([v, label]) => ({
     v, label,
     art: (
       /* `insp-glyph` is the class `G` itself renders, so both rows' figures are
          carried by the same box — not a second frame that happens to look alike. */
       <svg className="insp-glyph" viewBox="0 0 26 18" width={26} height={18}
         fill="none" stroke="currentColor" strokeWidth={2 / FLOW_GLYPH_SCALE}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
         <g transform={`translate(13 9) scale(${FLOW_GLYPH_SCALE}) translate(-12 -12)`}>
           {FLOW_ICON_PATHS[v]}
         </g>
       </svg>
     ),
   }));
  /** The goblin `body` switch (§B #12) — TWO options, not nineteen. */
  const BODY_OPTS: PickerOption[] = [
    {v: 'card', label: 'card', art: null},
    {v: 'label-only', label: 'label only', art: null},
  ];
  /* PACKAGE-P §E.1 — the Text section's three option tables. They carry NO art:
     §E.1 specifies a 4-step segmented size control, a 2-button weight toggle and
     a 3-button align row, and `ToggleRow` renders `o.art ?? o.label` — so the
     labels ARE the control, which is also why no glyph had to be invented for
     them. The tables themselves live in `src/textStyle.ts` (one source, shared
     with the harness) and are wrapped here only to satisfy `PickerOption`. */
  const SIZE_OPTS: PickerOption[] = TEXT_SIZE_OPTS.map(o => ({v: o.v, label: o.label, art: null}));
  const WEIGHT_OPTS: PickerOption[] = TEXT_WEIGHT_OPTS.map(o => ({v: o.v, label: o.label, art: null}));
  const ALIGN_OPTS: PickerOption[] = TEXT_ALIGN_OPTS.map(o => ({v: o.v, label: o.label, art: null}));
  /* ROUND X, ITEM 3 — THE FONT TABLE, AS FOUR SELF-PREVIEWING BUTTONS. It is no
     longer an `IconPickerRow` (trigger + popover): Harvey asked for "4 nút bấm
     chọn cùng 1 hàng nếu đc luôn", so it is now the SAME segmented idiom Size
     and Align use, one row, one control vocabulary in the panel. The app still
     renders zero native `<select>` — `checks/package-p-inspector.mjs` asserts
     that — and each button still previews its own family, which is the whole
     reason a font control is worth having and the thing a `<select>` cannot do.

     `family` here is the CSS stack for the BUTTON'S PREVIEW only. The value that
     reaches the node is the KEY, and the key is resolved to a stack by
     `TEXT_FONT_FAMILY` in `src/textStyle.ts` — one place, not two. */
  const FONT_OPTS: PickerOption[] = TEXT_FONT_OPTS.map(o => ({
    v: o.v, label: o.label,
    /* ROUND Z, ITEM 1 — THE BUTTON'S TOOLTIP IS THE FULL FAMILY NAME. The label
       is short because the full one does not fit a 3-column cell (measured: at
       10px `JetBrains Mono` is 84.0px and `Be Vietnam Pro` 75.2px, against a
       65px content box), so the short name is what prints and the real family
       name is what hovering says. */
    title: o.title,
    /* ROUND X, ITEM 3 — THE PREVIEW IS THE BUTTON'S OWN CONTENT. Each option
       prints its own family NAME in its own family. That is the one thing a
       native `<select>` cannot do, and it is why this control survives the
       change from a popover to a segmented row: the label and the sample are
       the SAME span, so the row prints each name exactly ONCE — there is no
       second cell to suppress and therefore nothing to hide. */
    art: (
      <span className="insp-font-btn" style={{fontFamily: TEXT_FONT_FAMILY[o.v]}}>
        {o.label}
      </span>
    ),
  }));
  /* ROUND Z, ITEM 2 — the three vertical positions. Plain data, same idiom as
     the three tables above: no art, so the label IS the control. */
  const VALIGN_OPTS: PickerOption[] = TEXT_VALIGN_OPTS.map(o => ({v: o.v, label: o.label, art: null}));
  /** Crow's-foot vocabulary (§B #9/#10) — IE / IDEF1X notation, drawn. */
  const CROW_FOOT: {v: string; label: string}[] = [
    {v: 'none', label: 'none'},
    {v: 'one', label: 'one (bar)'},
    {v: 'zeroOrOne', label: 'zero or one (ring + bar)'},
    {v: 'many', label: 'many (crow\u2019s foot)'},
    {v: 'zeroOrMany', label: 'zero or many (ring + foot)'},
    {v: MarkerType.ArrowClosed, label: 'arrow'},
  ];
  const CROW_END_OPTS: PickerOption[] = CROW_FOOT.map(o => ({
    ...o, art: <ArtCardinality kind={o.v} />,
  }));
  const CROW_START_OPTS: PickerOption[] = CROW_FOOT.map(o => ({
    ...o, art: <ArtCardinality kind={o.v} flip />,
  }));

  /* ---- PACKAGE-P §A.1: THE decision ------------------------------------
     ONE target, built here from the state that already exists, handed to the
     pure function in `src/inspector.ts`. Every branch below then renders from
     the returned ordered list, so the panel's shape is decided in exactly one
     place instead of by three nested ternaries in the render. */
  const inspTarget: InspectorTarget =
    edgeMode || selCount >= 2
      /* ROUND AK, AK-8 — THE CARDINALITY GATE IS READ FROM THE EDGE, NOT THE
         BOARD. `hasCrowFootEnds` asks whether the SELECTED edge carries a
         crow's-foot marker on either end (`isCrowFoot`), so the section appears
         on an edge that HAS cardinality to express and nowhere else — instead of
         appearing on every edge of an ERD board and no edge of any other. The
         multi-select branch carries no single edge, so it is false there; its
         Cardinality rows are meaningless for N edges anyway. */
      ? {kind: 'edge',
         hasCrowFootEnds: edgeMode
           ? (isCrowFoot((selectedEdge?.markerStart as any)?.type)
              || isCrowFoot((selectedEdge?.markerEnd as any)?.type))
           : false}
      : selected?.type === 'table' ? {kind: 'table'}
      : selected?.type === 'label' ? {kind: 'label'}
      : selected
        ? {kind: 'goblin', shape: asShape((selected.data as any).shape),
           body: (((selected.data as any).body ?? 'card') as 'card' | 'label-only')}
        : {kind: 'label'};
  const inspSections = getInspectorSections(inspTarget);
  /* ---- PACKAGE-P §A.1/§D: the ordered render ----------------------------
     Each branch REGISTERS its section bodies into `sectionBody` and then prints
     `renderSections()` — the ORDER comes from `inspSections`, i.e. from
     `src/inspector.ts` §D, not from the order the branches happen to build them
     in. That is the whole point of the pass: reordering the panel is now an edit
     to one array in a pure module, not a re-shuffle of 500 lines of JSX.

     `data-section` lands on every rendered section (§F.3 asserts the ordered
     list); `data-collapsed` is the literal `'false'` because there is no fold UI
     yet — §C's trigger rows and the `diagram-studio:inspector-sections`
     persistence are PASS 3. `data-collapsed-default` carries §A.3's truth table
     as data so pass 3 reads it instead of re-deriving it. */
  const sectionBody: Record<string, React.ReactNode> = {};
  const secBody = (id: SectionId, node: React.ReactNode) => { sectionBody[id] = node; };
  /** A branch is SHARED by several target kinds, so it may only REGISTER a body
   *  for a section the DECISION actually lists. `renderSections()` filters as
   *  well, but relying on that filter alone would hide the mistake: the body
   *  would still be built — its controlled reads and derived values evaluated —
   *  for a panel that never paints it. So the gate is expressed against
   *  `inspSections`, the same ordered list the painter walks: one source of
   *  truth, never a second copy of the ERD rule. */
  const hasSection = (id: SectionId) => inspSections.some(s => s.id === id);
  const SECTION_TITLES: Record<SectionId, string> = {
    content: 'Content',
    text: 'Text',
    style: 'Style',
    table: 'Table',
    columns: 'Columns',
    showMode: 'Show mode',
    label: 'Label',
    line: 'Line',
    markers: 'Markers',
    cardinality: "Cardinality (crow\u2019s foot)",
    flow: 'Flow animation',
  };
  /* A section is only PAINTED when the current branch REGISTERED a body for it.
     `content` and `style` are goblin-only; `table`/`columns`/`showMode` are
     table-only; on a fresh board the fallback target is `{kind:'label'}`, whose
     `text` body the label branch registers. A section with no body would be an
     empty shell with a title, so it is skipped rather than rendered blank. */
  /* PASS 3 §C — THE FOLDED ROW'S CURRENT VALUE. A fold that hid the thing it
     controls would be a lie; both readouts read the SAME node/edge data the
     expanded controls bind to, so there is no second source to drift. `label`
     names the value for assistive tech without turning it into the button's
     accessible name, which stays the section title. */
  const CROW_WORD: Record<string, string> = {
    one: 'one', zeroOrOne: 'zero or one', many: 'many', zeroOrMany: 'zero or many',
  };
  const crowWord = (end: unknown): string => {
    const k = typeof end === 'string' ? end : '';
    if (!k) return 'none';
    return CROW_WORD[k] ?? (k === MarkerType.ArrowClosed ? 'arrow' : k);
  };
  /* `count` is a field of exactly three flows (the stepper renders for
     dots/icon/event, App.tsx:4570), so the readout reports a number only where
     the expanded body would show one. */
  const flowReadout = () =>
    eFlow === 'none' ? 'off'
      : (eFlow === 'dots' || eFlow === 'icon') ? `on · ${eFlowCount}`
      : 'on';
  const FOLDED_READOUT: Partial<Record<SectionId, {node: React.ReactNode; label: string}>> = {
    cardinality: {
      node: <>
        {crowWord((selectedEdge?.markerStart as any)?.type)}
        {' → '}
        {crowWord((selectedEdge?.markerEnd as any)?.type)}
      </>,
      label: 'ends',
    },
    flow: {node: flowReadout(), label: 'flow'},
  };
  const renderSections = () => inspSections
    .filter(s => sectionBody[s.id] != null)
    .map(s => (
      <Section
        key={s.id}
        id={s.id}
        title={SECTION_TITLES[s.id]}
        collapsedDefault={s.collapsedDefault}
        collapsed={isCollapsed(s.id)}
        onToggle={toggleSection}
        readout={FOLDED_READOUT[s.id]?.node}
        readoutLabel={FOLDED_READOUT[s.id]?.label}
      >
        {sectionBody[s.id]}
      </Section>
    ));
  /** §B #11's preview colour is the node's LIVE outline colour, so the shape
   *  silhouettes recolour with the node exactly as the palette row does. */
  const nodeColor = selected ? resolveColor(selected.data as any) : COLOR_VAR.accent;


  /** L1 — the inspector swatches are COLOUR KEYS, painted with the live
   *  `var(--c-*)` token, so the swatch itself recolours with the theme. Picking
   *  one stores the key (not a hex), which is what makes light mode work.
   *
   *  ROUND AG2, ITEM 3 — the shared row lays the keys out in a fixed number of
   *  columns. This is the SHARED control: every one of its call sites renders
   *  the same keys, so a wrap problem is fixed once, here, rather than at the
   *  two rows that were noticed. The class is `swatch6`, NOT `grid3`: that name
   *  is the segmented font row's modifier (`.insp-seg.grid3`), and `.swatches`
   *  and `.insp-seg` are the same element there, so sharing the name would move
   *  the font row's gap. Measured in the `.swatches.swatch6` block in
   *  `src/styles.css`.
   *
   *  ROUND BD — THE BULK ROW'S CURRENT IS THE SHARED KEY, NOT A CONSTANT NULL.
   *  The old call passed a literal `null`, so all eleven cells always painted
   *  ringless — an all-off state on a control the user has demonstrably used
   *  (measured defect 8 of the old block). The single-node Style section lights
   *  the cell whose key is in force (`swatchRow(resolveColorKey(...), ...)`),
   *  and the bulk row now asks the SAME question of the batch: when every
   *  selected node resolves to the SAME key, that key lights — exactly the
   *  single-node contract. A mixed batch resolves to `null` (all off), which is
   *  honest: no ring may claim one colour for eleven nodes that disagree.
   *
   *  ROUND AO, AO-1a — SIX COLUMNS, NOT THREE. AG2 shipped `swatch3` and the
   *  three columns made every colour cell 80 x 26: a slab ("các ô nên nhỏ lại
   *  cho đẹp"). Six columns is `(253 - 5x7) / 6 = 36.3px` against the same 26px
   *  height, near-square and still a >= 36px tap target. One modifier, so all
   *  seven call sites moved at once — deliberately: two cell sizes in one panel
   *  would read as a mistake. The FULL reasoning lives beside the rule.
   *
   *  ROUND AO, AO-1c — THE THIRD PARAMETER IS NOW REAL, AND IT IS ONE OBJECT.
   *  `custom` used to be `custom?: string`, a hook no call site ever passed; it
   *  was the leftover of a custom-colour row that was never built. It is now
   *  `custom?: {value, onPick}` — the picked literal (so the cell can paint it
   *  and read as "on") plus the writer. ONE object rather than two positional
   *  parameters because the pair is only ever meaningful together: a `value`
   *  with no `onPick` would be a cell that paints a colour and cannot set one.
   *
   *  WHY THE SIGNATURE STAYS `swatchRow(current, onPick)`-COMPATIBLE. The
   *  parameter is OPTIONAL AND LAST, so the six call sites that do not offer a
   *  literal — Text `text color`, edge `text color`, edge `background color`,
   *  the bulk multi-select row, and the two that predate it — keep the exact
   *  call they had. Only the three rows where a literal is already legal (node
   *  Style `color`, edge `stroke color`, table `color`) pass it.
   *
   *  THE CUSTOM CELL IS A 12TH CELL, AFTER THE ELEVEN KEYS, and only when the
   *  caller opts in: 12 cells is a clean 6 x 2 in the six-column grid. It is
   *  `aria-label`led "Custom color" because its content is an input with no
   *  other name, and it carries `.on` when NO key is lit AND a literal is
   *  stored — i.e. when the custom colour is the one in force. */
  const swatchRow = (
    current: ColorKey | null,
    onPick: (k: ColorKey) => void,
    custom?: {value?: string; onPick: (hex: string) => void},
  ) => (
    <div className="swatches swatch6">
      {COLOR_KEYS.map(k => (
        <div
          key={k}
          className={`swatch${current === k ? ' on' : ''}`}
          style={{background: COLOR_VAR[k]}}
          data-color-key={k}
          title={k}
          onClick={() => onPick(k)}
        />
      ))}
      {custom && (
        <div
          className={`swatch-custom${!current && custom.value ? ' on' : ''}`}
          data-custom="1"
          /* the picked literal paints the cell; with none stored the class's own
             gradient stands, so an untouched row is byte-identical to one that
             never had this cell's colour set. */
          style={custom.value ? {background: custom.value} : undefined}
          title={custom.value ?? 'Custom color'}
        >
          <input
            type="color"
            aria-label="Custom color"
            /* the input must SHOW the stored literal or the OS picker opens on
               its own default; `#000000` is the fallback most engines use when no
               value is given, so it is named rather than left implicit. */
            value={custom.value ?? '#000000'}
            onChange={e => custom.onPick(e.target.value)}
          />
        </div>
      )}
    </div>
  );

  /** PACKAGE-P §E.2 — THE TEXT SECTION'S READER AND WRITER, and the reason they
   *  are a READER and a WRITER rather than one object.
   *
   *  READ (`tsShown`) is what the panel SHOWS: a node with no `textStyle`, or a
   *  field it never set, reads as the inherited value — M, Regular, no swatch,
   *  and the align the TARGET already renders with (`alignForBody`: since
   *  HARVEY 2026-10-22 every text target centres by default, on both axes).
   *  That is why the panel can say "default" in words without a second copy of
   *  the sheet's rules living in JSX.
   *
   *  WRITE (`writeTextStyle`) is what it STORES, and it is the lazy write
   *  (§E.2): choosing the inherited value again stores ABSENCE, so a field
   *  switched back to Default leaves nothing behind and a node the user never
   *  touched keeps `textStyle === undefined`. Same discipline as the colour
   *  swatches below, which write `colorKey` and derive `color` rather than
   *  storing both. `mergeTextStyle` does the decision; this only maps it onto
   *  the node — through `update()` for the selected node, so the write rides the
   *  existing pushHistory-once-per-commit path. The label kind goes through the
   *  SAME `update()`: it is the selected node, exactly as the goblin is. */
  const tsAlignDefault = alignForBody(inspTarget.kind === 'goblin' ? inspTarget.body : undefined);
  /* ROUND Z FIX 2 — the vertical default is read off the SAME target, by the
     same shape of helper. `alignForBody` and `vAlignForBody` are one answer each
     for panel, merge and emitter, so no two of them can describe the box
     differently. */
  const tsVAlignDefault = vAlignForBody(inspTarget.kind === 'goblin' ? inspTarget.body : undefined);
  const tsStored = (selected?.data as any)?.textStyle as TextStyle | undefined;
  const tsShown = readTextStyle(tsStored, tsAlignDefault, tsVAlignDefault);
  const writeTextStyle = (patch: Partial<TextStyle>) => {
    // undefined result means "nothing left to store" — the key is dropped
    // rather than left as an empty object, so `textStyle: undefined` never
    // reaches a board file.
    update({textStyle: mergeTextStyle(tsStored, patch, tsAlignDefault, tsVAlignDefault)} as any);
  };

  /* ROUND AM, AM-2 — THE EDGE TARGET'S READER AND WRITER, and why they are a
     second PAIR of two lines rather than a second implementation.

     The STORED FIELD differs (`data.labelStyle` on an edge, `data.textStyle` on
     a node) and so does the thing the write is applied to (`updateEdge` patches
     the selected EDGE; `update` patches the selected NODE). Everything that
     decides what a choice MEANS is shared: the same `readTextStyle` reads it,
     the same `mergeTextStyle` does the lazy write, and the same
     `TEXT_SIZE_OPTS` / `TEXT_WEIGHT_OPTS` / `TEXT_FONT_OPTS` tables drive the
     rows. A single generic helper would have to take the stored value, the
     setter and the target defaults as parameters and would be LONGER than these
     two expressions while hiding the one fact a reader needs — that a line and a
     node store the same `TextStyle` under two different keys.

     THE ONE HISTORY RULE IS INHERITED, NOT RE-STATED: `updateEdge` pushes once
     per commit exactly as `update` does, so a click on Bold is one undo step.
     That is also why the slider on the flow row needs the `coalesce` option
     while these chips do not — see the note at the speed row in the flow
     section. */
  const edgeLabelStored = (selectedEdge?.data as any)?.labelStyle as TextStyle | undefined;
  const edgeLabelShown = readTextStyle(edgeLabelStored, tsAlignDefault, tsVAlignDefault);
  const writeEdgeLabelStyle = (patch: Partial<TextStyle>) => {
    updateEdge({data: {labelStyle: mergeTextStyle(edgeLabelStored, patch, tsAlignDefault, tsVAlignDefault)}} as any);
  };

  /** PACKAGE-P §E.1 — THE TEXT SECTION'S BODY, written ONCE and registered by
   *  both targets that list the section (`goblin` §A.3 + `label` §E.3). Writing
   *  it twice would be two copies of four controls that must agree; the four
   *  reads all come from `tsShown` and the four writes all go through
   *  `writeTextStyle`, so the only per-target difference is the DEFAULT the read
   *  falls back to — which is already inside `tsShown`.
   *
   *  The colour control is §E.1's own instruction: "reuses the existing colour
   *  swatch row", i.e. the same `swatchRow` the Style section uses, so it
   *  stores a KEY and paints `var(--c-*)`. It is a DIFFERENT field from the
   *  Style section's colour — that one drives the outline, icon, metric and
   *  glow (`--nc`), this one drives the text.
   *
   *  Font family and opacity/fill are deliberately ABSENT (§E.1): one node
   *  already mixes `--mono` and `--sans`, so a single family control would be a
   *  lie, and neither has a DOM analogue. */
  const tsBody = (
    <>
      <div className="field">
        <label>size</label>
        {/* ROUND X, ITEM 1 — BACK TO THE BARE SEGMENTED ROW. ROUND W put a
            custom-size number input beside these four buttons, and that flex
            row squeezed the 4-column grid into a 31×121px COLUMN (Harvey:
            "UI lệch, quá xấu"). The input is GONE; the steps are the control
            again, full panel width, one row.

            THE RULE STAYS (Harvey: "rule giữ khi cần"). `scale` on `TextStyle`,
            `TEXT_SCALE_MIN/MAX`, `clampTextScale` and the `scale` read in
            `textStyleVars` are all still in `src/textStyle.ts`, so a board that
            already carries a custom multiplier still RENDERS it. What changed is
            only how the panel REPORTS one: `readTextStyle` now derives `size`
            from what actually paints (`stepForScale`), so a stored 1.7 lights NO
            step here rather than claiming M while the node paints 1.7. */}
        <ToggleRow
          /* `null` is "matches no step" — a custom multiplier. `?? ''` matches no
             option either, so nothing is marked and the node keeps painting its
             stored scale. */
          value={tsShown.size ?? ''}
          onChange={v => writeTextStyle({size: v as TextSize})}
          options={SIZE_OPTS}
          title="Text size"
        />
      </div>
      <div className="field">
        <label>weight</label>
        <ToggleRow
          value={tsShown.weight}
          onChange={v => writeTextStyle({weight: v as TextWeight})}
          options={WEIGHT_OPTS}
          title="Text weight"
        />
      </div>
      {/* ROUND W, ITEM 2 — THE FAMILY, FOR THE WHOLE NODE. Harvey's own choice:
          "cả node trước" — the one choice sets title + kicker + sub + metric +
          the label node's text. That FLATTENS the mix this section's header used
          to call out ("one node already mixes `--mono` and `--sans`, so a single
          family control would be a lie") and it is a decision, not an accident:
          the picker is worth having only if it actually changes what you read.
          The lie that note warned about is gone because the control now DOES set
          every one of those rows — see the EIGHT `var(--ts-font, …)` consumers
          in `src/styles.css`, one per row that owns node text. */}
      <div className="field">
        <label>font</label>
        {/* ROUND Z, ITEM 1 — SIX FAMILIES, TWO ROWS OF THREE, REAL NAMES.
            Harvey: "Font name hơi kì, nên theo tên Font" + "nếu 6 nút thì 3 3
            cho đẹp". The buttons print short labels because the full family
            names do not fit a 3-column cell (measured: `JetBrains Mono` 84.0px
            and `Be Vietnam Pro` 75.2px at 10px, against a 65px content box),
            and each carries its real name as the tooltip. `grid3` is the
            two-row modifier; the geometry is measured in the `.insp-seg.grid3`
            block in `src/styles.css`.

            THE HINT THAT USED TO SIT UNDER THIS CONTROL IS STILL GONE — with
            six self-previewing buttons the control states its own scope, and
            the whole Text section carries zero hints. */}
        <ToggleRow
          value={tsShown.font}
          onChange={v => writeTextStyle({font: v as TextFont})}
          options={FONT_OPTS}
          title="Text font for the whole node"
          grid3
        />
      </div>
      <div className="field">
        <label>text color</label>
        {/* ROUND AQ2 — the custom literal cell, same as the edge stroke row: the
            literal is stored on `textStyle.customColor` with `colorKey` cleared
            (the merge enforces the exclusion); a key pick clears the literal. The
            custom cell takes the ring when a literal is set (no hue lights). */}
        {swatchRow(tsShown.colorKey, k => writeTextStyle({colorKey: k, customColor: undefined}),
          {value: tsShown.customColor, onPick: hex => writeTextStyle({customColor: hex, colorKey: undefined})},
        )}
      </div>
      <div className="field">
        <label>align</label>
        {/* ROUND Z, ITEM 2 — TWO ROWS IN ONE FIELD: the horizontal row Harvey
            already had (Left / Center / Right, storing `align`), and the new
            vertical one (Top / Middle / Bottom, storing `vAlign`). Both are the
            same segmented control, both write through the same lazy-write
            helper, and the vertical one is ALWAYS PRESENT for a text target —
            the research flagged hiding it (Excalidraw force-sets `middle` when
            text binds, Figma has no control at all) as the anti-pattern to
            avoid. No hint: the whole Text section carries zero hints. */}
        <ToggleRow
          value={tsShown.align}
          onChange={v => writeTextStyle({align: v as TextAlign})}
          options={ALIGN_OPTS}
          title="Text align"
        />
        <ToggleRow
          value={tsShown.vAlign}
          onChange={v => writeTextStyle({vAlign: v as TextVAlign})}
          options={VALIGN_OPTS}
          title="Text vertical align"
        />
      </div>
    </>
  );

  /** ROUND AM, AM-2 — THE EDGE LABEL'S TEXT SECTION: the same three controls,
   *  the same tables, and deliberately not the same FOURTH and FIFTH rows.
   *
   *  WHY IT IS A SEPARATE CONST RATHER THAN A FLAG ON `tsBody`. The two bodies
   *  differ by a RULE, not by a rendering detail: `tsBody`'s colour and align
   *  rows are only meaningful for a target with a padded box and its own ink
   *  control. Threading a `forEdge` boolean through `tsBody` would put "an edge
   *  label is not a box" in the middle of five rows that DO apply, and would
   *  leave the two rows it must skip one `&&` away from coming back — the shape
   *  this project has already paid for. Written out, the omission is the
   *  structure: what is here is what an edge label has.
   *
   *  THE READER AND THE WRITER ARE THE NODE'S, DELIBERATELY. `read` reads the
   *  SAME `data.labelStyle` through the SAME `readTextStyle` (so a stored
   *  multiplier that matches no step lights no step here either, and a legacy
   *  ROUND-W font key reads as the family it already paints), and `write` goes
   *  through the SAME `mergeTextStyle` lazy write (so switching back to the
   *  inherited value stores ABSENCE and a label nobody touched keeps
   *  `labelStyle === undefined`). Those two functions take the two align
   *  defaults as arguments because those defaults are per-target; the pair
   *  passed here is never read, because no align row renders — passing them is
   *  what keeps one merge implementation rather than an edge-shaped copy.
   *
   *  THE THREE ROWS ARE THE SHARED TABLES, NOT COPIES: `SIZE_OPTS`,
   *  `WEIGHT_OPTS` and `FONT_OPTS` are built from `TEXT_SIZE_OPTS` /
   *  `TEXT_WEIGHT_OPTS` / `TEXT_FONT_OPTS`, i.e. the same `src/textStyle.ts`
   *  tables the goblin body renders. So the ladder, the weights and the six
   *  families cannot differ between a node and a line — one vocabulary.
   *
   *  NO COLOUR ROW, and that is a decision with a reason rather than an
   *  omission: the label's colour is `labelTextKey`, rendered as its own `text
   *  color` swatch row in the LABEL section, right above this one. A second
   *  swatch row here would be two controls for one stored fact. */
  const edgeLabelTextBody = (
    <>
      <div className="field">
        <label>size</label>
        <ToggleRow
          value={edgeLabelShown.size ?? ''}
          onChange={v => writeEdgeLabelStyle({size: v as TextSize})}
          options={SIZE_OPTS}
          title="Edge label text size"
        />
      </div>
      <div className="field">
        <label>weight</label>
        <ToggleRow
          value={edgeLabelShown.weight}
          onChange={v => writeEdgeLabelStyle({weight: v as TextWeight})}
          options={WEIGHT_OPTS}
          title="Edge label text weight"
        />
      </div>
      <div className="field">
        <label>font</label>
        <ToggleRow
          value={edgeLabelShown.font}
          onChange={v => writeEdgeLabelStyle({font: v as TextFont})}
          options={FONT_OPTS}
          title="Edge label text font"
          grid3
        />
      </div>
    </>
  );

  // ---- M3/S2d: the inspector is DOCKED, exactly like the palette ----
  // C4's selection-driven auto-hide is GONE, along with the `pinned` override it
  // needed: a panel is hidden when — and only when — the user collapsed it by
  // hand. Both sides therefore use the identical one-line rule, so selecting or
  // deselecting a node cannot move either panel, and the inspector no longer
  // vanishes (or half-draws) just because the canvas has no selection.
  const leftHidden = isPanelHidden(panelState, 'left');
  const rightHidden = isPanelHidden(panelState, 'right');

  // ---- M3/S2c: the shortcut reads THIS, not the raw `collapsed` flags -----
  // The keydown effect is registered once; if it closed over `leftHidden` /
  // `rightHidden` directly it would need them in its dep array, so it would tear
  // down and re-register on every collapse. A ref keeps the one listener and
  // still reads the live VISIBLE state: `hiddenRef.current` is what the user can
  // actually see at the instant the key is pressed.
  const hiddenRef = useRef({left: false, right: false});
  hiddenRef.current = {left: leftHidden, right: rightHidden};

  // ---- M3/S4 + M3/S5: the transient overlay ------------------------------
  // A tablet-portrait drawer and a phone bottom sheet are the SAME momentary
  // idea, so they share ONE piece of LOCAL state and ONE scrim. Deliberately
  // NOT part of PanelState: a drawer the user dismissed is not a "collapsed
  // panel", and persisting it under `diagram-studio:panels` would make it
  // reappear on desktop as a durable choice the user never made. The one
  // durable flag per side (`collapsed`) keeps its exact Step 2 meaning.
  const overlayMode: 'drawer' | 'sheet' | null =
    ui.formFactor === 'tablet' && !ui.isLandscape ? 'drawer'
      : ui.formFactor === 'phone' ? 'sheet'
        : null;
  const [overlay, setOverlay] = useState<'left' | 'right' | null>(null);
  // Read by the global keydown handler (registered above), which must not
  // re-register on every drawer open/close — same reason `hiddenRef` exists.
  const overlayRef = useRef<'left' | 'right' | null>(null);
  overlayRef.current = overlay;
  // A rotation or a tier change closes whatever was open: a drawer cannot stay
  // open across a layout that no longer has drawers.
  useEffect(() => { setOverlay(null); }, [overlayMode, pngScale, pngPad]);
  // Escape closes the overlay FIRST and stops there, so it does not also fall
  // through to the app's own "deselect" Escape (capture phase + stopPropagation).
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOverlay(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [overlay]);
  const closeOverlay = () => setOverlay(null);
  const openOverlay = (side: 'left' | 'right') => setOverlay(cur => (cur === side ? null : side));
  const overlayTitle = (side: 'left' | 'right', ov: boolean, mode: 'drawer' | 'sheet') =>
    `${ov ? 'Close' : 'Open'} ${side === 'left' ? 'left panel' : 'inspector'} — ${mode === 'drawer' ? 'drawer' : 'bottom sheet'}`;

  // ---- M3/S5: the phone bottom bar's real height -------------------------
  // Everything that must sit ABOVE the bar (both sheet openers, the toast, the
  // shortcut popover, the selection bar) derives its offset from this ONE
  // number. It has to be measured, not guessed: the bar wraps to two rows at
  // 360px and one at 932px, so any constant is wrong at one of them. Published
  // as `--toolbar-h` on `.app-host` (inline, so it wins over the stylesheet
  // fallback) and re-measured whenever the bar rewraps.
  const [toolbarH, setToolbarH] = useState(0);
  useEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>('.toolbar');
    if (!el) return;
    const read = () => setToolbarH(Math.ceil(el.getBoundingClientRect().height));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ui.formFactor, ui.isLandscape]);

  /** One toggle per panel edge — a PLAIN toggle on both sides. M3/S2d removed
   *  the selection-derived hide, so there is only one question left ("is it
   *  collapsed?") and only one answer to a click: expand if hidden, collapse if
   *  visible. No "pin open" action and no `.auto` tint, because there is no
   *  derived state left to escape from. This stays the per-side control; the
   *  global shortcut is `setPanelsVisible`.
   *
   *  No tooltip here on purpose: the button is 20x44 on a panel edge that is
   *  already labelled by the panel itself, and the popover only got in the way
   *  of repeated clicking. The accessible name (`aria-label`) carries the same
   *  information for assistive tech.
   */
  /** The panel VISIBLE-state predicate, shared by the shortcut and the render.
   *  A docked panel is visible unless collapsed; in a drawer/sheet tier the
   *  docked column is always laid out, so "visible" there means the OVERLAY is
   *  the one showing it. One predicate keeps a shortcut from focusing a field
   *  that is not on screen. */
  const isPanelVisible = (side: 'left' | 'right') =>
    overlayMode !== null ? overlayRef.current === side : !isPanelHidden(panelState, side);

  const panelToggle = (side: 'left' | 'right') => {
    const hidden = side === 'left' ? leftHidden : rightHidden;
    const label = side === 'left' ? 'left panel' : 'inspector';
    // PACKAGE-Q. Two different spellings of the same physical key, deliberately:
    //   * the DISPLAY chord is what the user reads on the chips below;
    //   * `aria-keyshortcuts` takes the ARIA token spelling of the key the
    //     handler matches on (`BracketLeft`/`BracketRight`), never a glyph and
    //     never the shifted character.
    // The chord itself mirrors the handler: Cmd+Ctrl+Shift on macOS, and the
    // shipped Ctrl+Shift form elsewhere (no Cmd key exists there).
    const macPlatform = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
    const sideKey = side === 'left' ? 'BracketLeft' : 'BracketRight';
    const sideGlyph = side === 'left' ? '[' : ']';
    const ariaChord = `${macPlatform ? 'Meta+Control' : 'Control'}+Shift+${sideKey}`;
    // M3/S4+S5: in a drawer/sheet layout this same control is the overlay
    // OPENER, not the collapse flag. The chevron keeps pointing the way it
    // always did and the Step 2 collapse flag is left completely alone, so a
    // tablet never rewrites the desktop layout the user configured.
    const isOverlay = overlayMode !== null;
    const ovOpen = overlay === side;
    // The tooltip's ACTION text, which is also the accessible name. `aria-label`
    // is NOT replaced by the tooltip: assistive tech gets the name here, and the
    // chord through `aria-keyshortcuts`, whether or not a popover is visible.
    const action = isOverlay
      ? overlayTitle(side, ovOpen, overlayMode ?? 'drawer')
      : `${hidden ? 'Expand' : 'Collapse'} ${label}`;
    // left: collapse points left (outward), expand points right (inward).
    // right: mirrored.
    const Icon = side === 'left'
      ? (hidden ? ChevronRight : ChevronLeft)
      : (hidden ? ChevronLeft : ChevronRight);
    const button = (
      <button
        type="button"
        className={`panel-toggle${hidden && !isOverlay ? ' hidden' : ''}`}
        data-panel-toggle={side}
        data-overlay-toggle={isOverlay ? overlayMode : undefined}
        aria-label={action}
        aria-expanded={isOverlay ? ovOpen : !hidden}
        // No chord while this control opens an overlay: no keyboard shortcut
        // opens a drawer or a bottom sheet, and advertising one here would be a
        // promise the handler does not keep.
        aria-keyshortcuts={isOverlay ? undefined : ariaChord}
        onClick={() => {
          if (isOverlay) { openOverlay(side); return; }
          togglePanel(side);
        }}
      >
        <Icon size={14} />
      </button>
    );
    // Keys render as `kbd` chips, gestures as plain text — the app's rule. The
    // overlay tier keeps its plain-text tooltip and carries NO chord.
    if (isOverlay) return button;
    return (
      <Tooltip
        label={
          <>
            {action} <span className="tt-keys">
              <kbd>{macPlatform ? '⌘' : 'Ctrl'}</kbd>
              {macPlatform && <kbd>⌃</kbd>}
              <kbd>⇧</kbd><kbd>{sideGlyph}</kbd>
            </span>
          </>
        }
      >
        {button}
      </Tooltip>
    );
  };

  /** =====================================================================
   *  PACKAGE-N pass 2c — ONE palette row, rendered from the data alone.
   *
   *  Deliberately a local function, not a component: it closes over
   *  `addNodeByLabel`, `isStarred` and `toggleFavourite`, so extracting it to a
   *  module would mean threading three callbacks through props for no gain.
   *
   *  `dimmed` is §9's "collapsed category still contributes hits". While
   *  searching, a row whose category is folded renders at reduced opacity
   *  instead of vanishing — the hit is never HIDDEN, only de-emphasised, which
   *  is the difference between "your shape is not here" and "your shape is
   *  here, in a section you folded".
   *
   *  THE ROW IS glyph + label + hint + star. Revision 3 removed the `types[]`
   *  BADGE this used to render; `types[]` is still on the item (the model's
   *  membership field) but nothing paints it, so a single-type element no
   *  longer repeats its own category back at the user.
   *  ===================================================================== */
  const renderPaletteRow = (p: PaletteItem, key: string, dimmed = false) => (
    <div
      key={key}
      className={`pal-item${dimmed ? ' pal-dimmed' : ''}`}
      draggable
      data-label={p.label}
      data-dimmed={dimmed ? 'true' : undefined}
      // pass 2b — the payload is the item's unique LABEL, never an index: the
      // panel no longer renders the same array it resolves against, so a
      // rendered index and a library index are different numbers.
      onDragStart={e => e.dataTransfer.setData('palette', p.label)}
      onDoubleClick={() => addNodeByLabel(p.label)}
      title="Drag onto the canvas or double-click to add"
    >
      <div className="pal-swatch">
        {p.kind === 'label'
          ? <span style={{color: COLOR_VAR[p.colorKey]}}>T</span>
          : p.label === 'Table'
            ? <TableGlyph color={COLOR_VAR[p.colorKey]} />
            : <ShapePreview shape={p.shape} color={COLOR_VAR[p.colorKey]} />}
      </div>
      <div className="pal-meta">
        <span>{p.label}</span>
        <small>{p.hint}</small>
      </div>
      {/* §6.3 — star / pin. `onPointerDown` stops the drag-from-row gesture so a
          star click can never start dragging the shape underneath it. */}
      <button
        type="button"
        className={`pal-star${isStarred(p.label) ? ' on' : ''}`}
        data-star={p.label}
        aria-pressed={isStarred(p.label)}
        aria-label={isStarred(p.label)
          ? `Remove ${p.label} from Favourites`
          : `Add ${p.label} to Favourites`}
        title={isStarred(p.label) ? 'Remove from Favourites' : 'Add to Favourites'}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); toggleFavourite(p); }}
      >{isStarred(p.label) ? '★' : '☆'}</button>
    </div>
  );

  return (
    <div
      className="app-host"
      ref={appRef}
      data-form-factor={ui.formFactor}
      data-touch={ui.isTouchScreen}
      style={{'--toolbar-h': toolbarH ? `${toolbarH}px` : undefined} as React.CSSProperties}
    >
    <div
      className={[
        'app',
        rightHidden ? 'right-hidden' : '',
        leftHidden ? 'left-hidden' : '',
        animate ? '' : NO_ANIM,
      ].filter(Boolean).join(' ')}
      data-form-factor={ui.formFactor}
      data-can-fit-sidebar={ui.canFitSidebar}
      data-touch={ui.isTouchScreen}
      data-orientation={ui.isLandscape ? 'landscape' : 'portrait'}
      data-overlay={overlay ?? ''}
    >
      {/* M3/S4+S5 — the ONE backdrop shared by the tablet drawer and the phone
          bottom sheet. A <button>, not a div: it is a real dismiss target, so
          it must be reachable and it must not swallow the canvas's own
          pointer events while closed (it only exists while the overlay is). */}
      {overlay && (
        <button
          type="button"
          className="scrim"
          data-scrim={overlayMode}
          aria-label={`Close ${overlay === 'left' ? 'left panel' : 'inspector'}`}
          tabIndex={-1}
          onClick={closeOverlay}
        />
      )}
      {panelToggle('left')}
      {panelToggle('right')}
      {/* LEFT — palette */}
      <aside className="panel">
        <div className="panel-head">
          <div className="brand">
            <img className="brand-mark" src="/brand/icon-g.svg" alt="" width={16} height={16} aria-hidden="true" />Gobigrams
          </div>
          <div ref={boardsBtnRef} style={{position: 'relative', marginTop: 10}}>
            {/* CONFIG-FIX (2026-10-22) — HARVEY: the hover tooltip covered the
                freshly-portal'd popover (it opens right beside this button), so
                the Tooltip wrapper is GONE; the button keeps its aria-label. */}
            <button
              type="button"
              ref={boardsMenuBtnRef}
              className={`tbtn-dd boards-btn${boardsOpen ? ' on' : ''}`}
              aria-label="Boards menu"
              aria-expanded={boardsOpen}
              onClick={() => { setBoardsOpen(o => !o); void refreshBoards(); }}
            >
              <LayoutGrid size={13} style={{verticalAlign: -2}} />
              <span className="boards-name">{curBoard ? curBoard.name : 'Boards'}</span>
              <ChevronDown size={12} style={{verticalAlign: -2}} />
            </button>
            {/* ITEM B (2026-10-22) — the popover is PORTAL'D TO BODY and
                position:fixed (Tooltip.tsx:205 precedent): `.panel` clips at
                232px (overflow:hidden), so the redesigned 360px popup could
                never render inside the head. The inline style carries the
                anchor computed in `boardsPopClamp` (left = button right + 6,
                top = button top, max-width = viewport − anchor − 8). */}
            {/* GOBI-S1 — the popover JSX moved to src/components/BoardsPopover.tsx
                (the extraction that paid for this round's App lines; harness
                boards-popover-pinned reads App + useBoardsMenu + the component). */}
            <BoardsPopover
              open={boardsOpen}
              pos={boardsPopPos}
              modeLabel={modeLabel}
              localMode={localMode}
              storageEstimate={storageEstimate}
              boardList={boardList}
              curBoard={curBoard}
              fmtDate={fmtDate}
              onOpenBoard={id => void openBoard(id)}
              onClose={() => setBoardsOpen(false)}
              onNewBoard={() => { setBoardsOpen(false); newBoard(); }}
              onTemplates={() => { setBoardsOpen(false); pendingBoardName.current = ''; setTgOpen(true); }}
              onRename={() => { setBoardsOpen(false); renameBoard(); }}
              onDuplicate={() => { setBoardsOpen(false); void doDuplicateBoard(); }}
              onDelete={() => { setBoardsOpen(false); deleteBoard(); }}
              onSaveNow={() => { setBoardsOpen(false); void flushSave(); }}
            />
          </div>
          <div className={`save-ind${saveState === 'saving' ? ' busy' : ''}${saveState === 'error' ? ' err' : ''}`} aria-live="polite">
            {saveState === 'saving' ? 'saving…' : saveState === 'saved' ? 'saved' : saveState === 'error' ? 'save failed' : (dirty && !autosave ? 'unsaved' : '')}
          </div>
        </div>
        <div className="panel-body">
          {/* PACKAGE-N §4.1 (Revision 3) — THREE sections in ONE scroll
              container, in this order: search → favourites → categories.
              The omnibox is now IN this pass; the type-filter row that used to
              sit between favourites and categories is GONE (see the state block
              above for the measurement that removed it). */}

          {/* ---- SEARCH (§4.1 #1, §9) -------------------------------------
              Pinned at the top so it stays the panel's first control, and
              BEFORE Favourites: the field searches the shape LIBRARY, and a
              query is a stronger statement of intent than a favourite tile.
              It searches the WHOLE library, never the current view — a hit for
              a shape is always reachable, whatever is folded. ---- */}
          <div className="lib-search">
            <input
              ref={searchRef}
              type="search"
              className="lib-search-input"
              data-lib-search="true"
              placeholder="Search shapes…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search shapes by name, shape or synonym"
              onKeyDown={e => {
                // Escape clears first and stops there, so it never also falls
                // through to the app's own "deselect" Escape behind it.
                if (e.key === 'Escape' && query) {
                  e.stopPropagation();
                  setQuery('');
                }
              }}
            />
          </div>

          {/* ---- FAVOURITES (§6) ------------------------------------------
              Rendered only when there is something to show: a favourite, or a
              live selection (which makes the pending `+` tile meaningful). An
              empty section would be a permanent, useless header. ---- */}
          {(favourites.length > 0 || selCount > 0) && (
            <div className="fav-sec" data-fav-count={favourites.length} data-sel-count={selCount}>
              <div className="sec-label">Favourites</div>
              <div className="fav-grid">
                {/* §6.4 — the pending `+`: "add from selection", one click, no
                    menus. Only while a selection exists on the canvas. */}
                {selCount > 0 && (
                  <button
                    type="button"
                    className="fav-tile fav-pending"
                    data-fav-pending="true"
                    aria-label={`Save the ${selCount} selected node${selCount === 1 ? '' : 's'} to Favourites`}
                    title={`Add ${selCount} selected node${selCount === 1 ? '' : 's'} to Favourites`}
                    onClick={addFavouriteFromSelection}
                  >
                    <span className="fav-glyph" aria-hidden="true">+</span>
                    <span className="fav-name">Add selection</span>
                  </button>
                )}
                {favourites.map(f => (
                  <button
                    type="button"
                    key={f.id}
                    className="fav-tile"
                    data-fav-id={f.id}
                    data-fav-label={library.favouriteLabel(f) ?? ''}
                    draggable
                    // §6.5 — a drop re-derives the geometry; only the IDENTITY
                    // travels in the payload, never a stored coordinate.
                    onDragStart={e => e.dataTransfer.setData('favourite', f.id)}
                    onDoubleClick={() => insertFavourite(f)}
                    title={`Add “${library.favouriteName(f)}” to the canvas — click, double-click or drag`}
                    onClick={() => insertFavourite(f)}
                  >
                    <span className="fav-glyph" aria-hidden="true">{favouritePreview(f)}</span>
                    <span className="fav-name">{library.favouriteName(f)}</span>
                    {/* ROUND AB, ITEM 2 — REMOVE FROM THE STRIP.
                        ROUND AE — EVERY TILE NOW CARRIES IT, AND IT REMOVES BY ID.
                        Harvey: "tôi muốn shape trong favorite cũng có thể có
                        icon để click remove khỏi favorite". Until ROUND AB the
                        only way out of Favourites was the star on the palette
                        row, which means scrolling the library back to the item
                        you just removed from your shortlist.

                        ROUND AB RENDERED THIS ONLY WHERE A LABEL EXISTED, because
                        the removal matched by label and a selection-saved
                        favourite has none — so the control was absent on exactly
                        the tiles that had no other way out. ROUND AE keys the
                        removal on `f.id` (see `removeFavourite` above), so the
                        condition is gone: every tile has a `×`, including the
                        ones saved from a selection.

                        WHAT IT STOPS, and nothing else. The tile inserts on
                        `click` (and double-click, and drag), so this control
                        stops: `click` (the whole point — a remove must never
                        also insert), `dblclick` (a fast double-tap on the `×`
                        would otherwise reach the tile's insert), and
                        `dragstart` (mousedown on a child of a `draggable`
                        button can begin the tile's drag, and the drag is what
                        actually inserts on canvas drop). `keydown` stops its
                        own Enter / Space so the key that activates the `×`
                        cannot also reach a handler behind it.

                        ALWAYS VISIBLE, at low emphasis (opacity .6) — not
                        hover-only. This project treats tablet and phone as in
                        scope, and there is no hover on a tablet: a
                        hover-revealed control would be unreachable there. The
                        `:focus-within` / `:hover` rules in `styles.css` only
                        raise its emphasis, so touch users get the same target a
                        mouse user does.

                        A `<span role="button" tabIndex={0}>` rather than a
                        nested `<button>`: identical to `.cust-remove` on the
                        custom-shape tiles 40 lines below, so the two grids of
                        tiles stay one control vocabulary — and a nested
                        interactive element would be invalid inside the tile's
                        own `<button>`.

                        THE REMOVAL ITSELF IS NOT REIMPLEMENTED: it calls
                        `removeFavourite` → the SAME `mutateFavourites` write
                        path the palette star uses, now ending in
                        `library.removeFavouriteById`. */}
                    <span
                      className="fav-remove"
                      role="button"
                      tabIndex={0}
                      data-fav-remove={f.id}
                      aria-label={`Remove ${library.favouriteName(f)} from Favourites`}
                      title={`Remove ${library.favouriteName(f)} from Favourites`}
                      onClick={e => {
                        e.stopPropagation();
                        removeFavourite(f.id);
                      }}
                      onDoubleClick={e => e.stopPropagation()}
                      onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          removeFavourite(f.id);
                        }
                      }}
                      ><X size={12} strokeWidth={2.5} /></span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ---- CUSTOM SHAPES (§4.1 item 3, §8.1–§8.3) --------------------
              ALWAYS rendered, unlike Favourites above it: this section owns
              the IMPORT control, and that control is the only way a first
              shape can ever exist. An empty section here is not a useless
              header — it is the door.

              The artwork is drawn from `svgDataUri` through an `<img>`, never
              as markup: the data: URI context disables scripts and external
              fetches, which is the second guard behind the sanitiser. ---- */}
          <div className="cust-shapes" data-cust-count={shapes.length}>
            <div className="cust-head">
              <span className="sec-label">Custom shapes</span>
              <button
                type="button"
                className="cust-import"
                data-custom-import-btn="true"
                aria-label="Import an SVG file as a custom shape"
                title="Import an SVG file as a custom shape"
                onClick={openShapeImport}
              >
                Import
              </button>
            </div>
            {/* Visually hidden, but the ONE picker every affordance clicks. */}
            <input
              ref={importInputRef}
              type="file"
              accept=".svg,image/svg+xml"
              className="cust-file"
              data-custom-import-input="true"
              aria-label="Choose an SVG file to import"
              onChange={onImportInputChange}
            />
            <div className="cust-grid">
              {shapes.map(s => (
                <button
                  type="button"
                  key={String(s.created)}
                  className="fav-tile cust-tile"
                  data-custom-shape={String(s.created)}
                  data-custom-title={s.title}
                  draggable
                  // §8.1 — the payload is the sanitised MARKUP, not an id: the
                  // stored entry has no id field, and the canvas resolves this
                  // exact string back to the entry it already holds.
                  onDragStart={e => e.dataTransfer.setData('customshape', s.data)}
                  onDoubleClick={() => insertCustomShape(s)}
                  /* ROUND BE (2026-10-23, Harvey: a single click must NOT
                     insert — parity with the palette). The onClick here used to
                     insert immediately, which the palette rows
                     (`renderPaletteRow`: drag or double-click, no onClick) and
                     the canvas both punish — one stray click littered the
                     board. This tile now follows the PALETTE convention, not
                     the favourites' (which are click-to-insert by design, and
                     stay so). Double-click and drag still work unchanged. */
                  title={`Drag onto the canvas or double-click to add “${s.title}”`}
                >
                  <span className="fav-glyph" aria-hidden="true">
                    <img src={svgDataUri(s.data)} alt="" className="cust-art" />
                  </span>
                  <span className="fav-name">{s.title}</span>
                  {/* `created` is the stable identity — the store has no id. */}
                  <span
                    className="cust-remove"
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove ${s.title}`}
                    title={`Remove ${s.title}`}
                    onClick={e => {
                      e.stopPropagation();
                      removeCustomShape(String(s.created));
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        removeCustomShape(String(s.created));
                      }
                    }}
                    ><X size={12} strokeWidth={2.5} /></span>
                </button>
              ))}
              {/* The drop zone is ALWAYS a tile, and always LAST: it is the
                  whole grid while the library is empty, and the "add the next
                  one" cell once shapes exist. Without it the second import
                  would only be reachable through the button. */}
              <button
                type="button"
                className={`cust-drop${shapes.length ? ' cust-drop-compact' : ''}`}
                data-custom-dropzone="true"
                aria-label="Drop an SVG here, or click to choose a file"
                title="Drop an SVG here, or click to choose a file"
                onClick={openShapeImport}
                {...shapeZoneProps}
              >
                <span className="cust-drop-glyph" aria-hidden="true">+</span>
                <span className="cust-drop-text">Drop an SVG here, or Import</span>
              </button>
            </div>
          </div>

          {/* ---- THE LIBRARY -------------------------------------------------
              TWO states, ONE list of 8 categories (§2, canonical order):

                query EMPTY     the normal accordion. All 8 sections always
                                render with their full counts — nothing filters
                                them any more, so a category can never be absent.
                query NON-EMPTY a flat result list grouped by category. A hit
                                whose category is COLLAPSED renders DIMMED, not
                                hidden (§9): collapsing a section must never
                                hide a search hit, or the user concludes the app
                                does not have the shape at all. Empty categories
                                are dropped here (a "(0)" header is noise);
                                clearing the field restores the accordion with
                                its persisted fold state untouched. ---- */}
          <div className="sec-label">Shapes</div>

          {searching ? (
            <div className="lib-cats" data-searching="true">
              {searchGroups.map(({cat, label, items}) => (
                <div className="lib-cat" key={cat} data-cat={cat} data-search-group={cat}>
                  <div className="lib-search-head">
                    <span className="lib-cat-name">{label}</span>
                    <span className="lib-cat-n" data-group-count={items.length}>{items.length}</span>
                  </div>
                  <div className="palette">
                    {items.map(p => {
                      // Dimmed IFF the user folded this section. The fold is
                      // read from the same persisted map the accordion uses, so
                      // the two states can never disagree.
                      const folded = !isCategoryOpen(presetId, cat);
                      return renderPaletteRow(p, `${cat}-${p.label}`, folded);
                    })}
                  </div>
                </div>
              ))}
              {/* A quiet line, not an error: an unmatched query is a normal
                  state (the library is 34 fixed elements). */}
              {searchGroups.length === 0 && (
                <div className="lib-no-match" data-no-match="true">No shape matches</div>
              )}
            </div>
          ) : (
            <div className="lib-cats">
              {librarySections.map(({cat, label, items}) => {
                const open = isCategoryOpen(presetId, cat);
                return (
                  <div className="lib-cat" key={cat} data-cat={cat}>
                    <button
                      type="button"
                      className="lib-cat-head"
                      aria-expanded={open}
                      data-cat-head={cat}
                      data-open={open ? 'true' : 'false'}
                      data-default-open={cat === defaultOpen ? 'true' : undefined}
                      onClick={() => toggleCategory(presetId, cat)}
                    >
                      <ChevronDown size={13} className={`lib-chev${open ? ' open' : ''}`} />
                      <span className="lib-cat-name">{label}</span>
                      <span className="lib-cat-n" data-cat-count={cat}>{items.length}</span>
                    </button>
                    {open && (
                      <div className="palette">
                        {items.map(p => renderPaletteRow(p, `${cat}-${p.label}`))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* The old sidebar guideline block lived here. Harvey: it ate panel
              space for information that belongs in the help surface ("choáng
              chỗ bỏ qua"). Every row it carried is now in the `?` sheet,
              Settings → Shortcuts AND the README table — verified one-for-one —
              so removing it loses nothing. Do not re-add a permanent hint block
              to the panel; put new guidance in those three surfaces instead. */}
        </div>
      </aside>

      {/* CENTER — canvas */}
      <main
          className="canvas-wrap"
          ref={wrap}
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}>
        {/* GOBI-S1 — the share view's banner (or its error card) sits above
            the toolbar: a fragment-owned board announces itself read-only and
            offers the ONE exit. Nothing renders when no fragment is present. */}
        {(shareDoc || shareError) && (
          <ShareBanner
            mode={shareError ? 'error' : 'viewing'}
            boardName={shareDoc?.name ?? ''}
            reason={shareError ?? undefined}
            onEditCopy={editCopy}
            onOpenApp={dismissError}
          />
        )}
        {/* ROUND BN-3 PHASE B: the toolbar + the 2+-selection action bar live
            in src/components/Toolbar.tsx; App threads every state/handler. */}
        <Toolbar
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onFitView={() => rf?.fitView({padding: 0.25})}
          readOnly={readOnly}
          onToggleReadOnly={toggleReadOnly}
          shareLock={!!shareDoc}
          alignGuides={alignGuides}
          onSetAlignGuides={setAlignGuides}
          onSetGuides={setGuides}
          snap={snap}
          onSetSnap={setSnap}
          onPushHistory={pushHistory}
          onSetNodes={setNodes}
          gridSize={gridSize}
          onDuplicate={() => duplicateSelection()}
          onAutoLayout={autoLayout}
          onOpenExport={setExpOpen}
          settingsOpen={settingsOpen}
          onOpenSettings={setSettingsOpen}
          settingsBtnRef={settingsBtnRef}
          selCount={selCount}
          onAlign={align}
          onDistribute={distribute}
          onDelete={deleteSelection}
          sep={sep}
        />

        {notice && <div className="toast">{notice}</div>}

        {/* H2: getting-started checklist — ticks as the user performs actions.
            ITEM 3: no `onAllDone`. Completing all 6 auto-hides the panel (its own
            `done.size >= TASKS.length` return below); the toast it used to raise
            fired on EVERY load for anyone who had already finished, because the
            once-per-mount guard was a ref that reset with the page. */}
        <Checklist
          doneSignal={doneSignal}
          hasSecondBoard={boardList.length >= 2}
        />

        {/* H1: guided tour overlay — ONBOARD-P1: on request only, never on first visit */}
        {tourOpen && (
          <Tour
            onDone={closeTour}
            onSkip={closeTour}
          />
        )}

        {/* F2: context menu (node / edge / pane right-click) */}
        {ctx && (
          <ContextMenu
            target={ctx}
            onAction={a => ctxAction(a, ctx)}
            onClose={() => setCtx(null)}
          />
        )}

        {/* C5: zoom pill — rendered inside ReactFlow so useStore resolves.
            Positioned absolute relative to the .react-flow container. */}
        {/* D2: keyboard cheat sheet */}
        {/* D2: keyboard cheat sheet — ROUND BN-3 PHASE B: the whole block
            (button + popover) lives in src/components/HelpSheet.tsx now;
            App threads the open state, the two refs and the two openers. */}
        <HelpSheet
          btnRef={helpBtnRef}
          popRef={helpRef}
          open={help}
          onToggle={() => setHelp(h => !h)}
          onTakeTour={() => { setHelp(false); setTourOpen(true); }}
          onSendFeedback={() => { setHelp(false); feedbackReturn.current = helpBtnRef.current; setFeedbackOpen(true); }}
        />

        {/* D1: searchable insert palette */}
        {searchPos && (
          <SearchPalette
            items={LIBRARY}
            onInsert={insertFromSearch}
            onClose={() => setSearchPos(null)}
          />
        )}

        {/* ROUND BN-3 PHASE B: the five modal mounts (BoardDialog, gallery,
            Settings, FeedbackDialog, ExportModal + the hidden JSON input) live
            in src/components/ModalMounts.tsx; App computes every prop. */}
        <ModalMounts
          boardDlg={boardDlg}
          curBoardName={curBoard?.name ?? ''}
          onCancelBoardDlg={closeBoardDlg}
          onSubmitBoardDlg={onBoardDialog}
          returnFocusTo={boardsMenuBtnRef}
          nextUntitledName={boards.nextUntitledName(boardList.map(b => b.name))}
          onBrowseTemplates={(name) => { pendingBoardName.current = name; setBoardDlg(null); setTgOpen(true); }}
          tgOpen={tgOpen}
          onCloseGallery={closeGallery}
          onUseTemplate={useTemplate}
          settingsOpen={settingsOpen}
          onCloseSettings={() => setSettingsOpen(false)}
          settingsProps={{
            mode,
            onMode: chooseMode,
            resolved: theme,
            noCycles,
            onNoCycles: setNoCycles,
            oneIn,
            onOneIn: setOneIn,
            dblConnect,
            onDblConnect,
            dblRange,
            onDblRange,
            gridSize,
            onGridSize,
            alignGuides,
            onAlignGuides: setAlignGuides,
            animate,
            onAnimate: toggleAnimate,
            highlight,
            onHighlight: toggleHighlight,
            marquee: marqueeMode,
            onMarquee: setMarqueeMode,
            zOrder: zOrderMode,
            onZOrder: setZOrderMode,
            layoutDir,
            onLayoutDir: setLayoutDir,
            pngScale,
            onPngScale,
            pngPad,
            onPngPad,
            autosave,
            onAutosave,
            returnFocusTo: settingsBtnRef,
            boardPng: nodes.length ? boardPngForFeedback : null,
            onOpenFeedback: openFeedback,
          }}
          feedbackOpen={feedbackOpen}
          onCloseFeedback={() => setFeedbackOpen(false)}
          feedbackReturn={feedbackReturn}
          boardPng={nodes.length ? boardPngForFeedback : null}
          expOpen={expOpen}
          onCloseExport={() => setExpOpen(false)}
          nodes={nodes}
          edges={edges}
          liveTheme={theme}
          boardName={curBoard?.name}
          selCount={selCount}
          buildSvg={buildSvg}
          buildPng={buildPng}
          printPdf={printPdf}
          fileRef={fileRef}
          onImportFile={onImportFile}
        />

        {/* J: Excalidraw-style canvas navigation — plain LEFT-drag box-selects
            (see `selectionOnDrag`), Shift+drag box-selects from a node too,
            middle/right drag + Space+drag pan, plain scroll pans (free, both
            axes), Ctrl/Cmd+scroll (trackpad pinch) zooms. ROUND AA, ITEM 2 — the
            marquee's own mode is the `selectionMode` prop below, driven by
            Settings → Canvas → Marquee selection. */}
        {/* K1: ds-flow-wrap scopes the hover-choreography + perf-guard classes
            to THIS React Flow instance. K3: ds-animating-layout (added/removed
            around programmatic layouts) and ds-no-anim (animation gating). */}
        <ReactFlow
          nodes={rfNodes} edges={rfEdges} /* badge hidden 2026-10-25; credit -> About */ proOptions={{hideAttribution: true}}
          onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange}
          onConnect={onConnectRules}
          onConnectStart={(_e, params) => { if (params.nodeId) { pendingDrop.current = {source: params.nodeId!, target: '', sourceHandle: params.handleId, targetHandle: null} as any as Connection; connectOrigin.current = {nodeId: params.nodeId!, handleId: params.handleId}; } }}
          onConnectEnd={onConnectEnd}
          onReconnect={onReconnect}
          // Q: gated exactly like the three element-touching props below, so
          // review mode has ONE source of truth for "nothing on the canvas can
          // be changed". `edgesReconnectable` was the lone omission — the
          // anchors are rendered whenever the prop is truthy and they are NOT
          // read-only aware, so in review mode the user could still rip a wire
          // off a node (and `onReconnect` would then push an undo entry for a
          // change the mode promises is impossible). The grabber is invisible,
          // so this is also the only arm of the gesture that could be started by
          // accident. With the prop false RF renders no `EdgeUpdateAnchors` at
          // all (`isReconnectable && …` in EdgeWrapper), i.e. the whole gesture
          // is absent, not merely inert. That is the ONLY entry point — grep for
          // `reconnect` in src/ returns this line, `onReconnect` above, and its
          // `reconnectEdge` call, so no second path exists. `reconnectRadius` is
          // a top-level `<ReactFlow>` prop and carries no behaviour of its own.
          edgesReconnectable={!readOnly}
          reconnectRadius={RECONNECT_RADIUS}
          // B2: every connection point is usable in BOTH directions. Each node
          // carries a source AND a target handle at each of its 8 points (see
          // NodeHandles in DiagramNode.tsx), and Loose is what lets a drag also
          // run source→source or target→target on one point. Under the default
          // Strict mode a drag must leave a source and land on a target, so a
          // corner could only ever work one way round.
          connectionMode={ConnectionMode.Loose}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={setRf}
          // L1: React Flow's colorMode themes its own ~24 --xy-* vars. It writes
          // nothing to document, so we resolve 'system' ourselves and pass only
          // the concrete mode; `.ds-flow-wrap` re-points the --xy-* vars we use
          // at our own tokens so paper / midnight / contrast follow too.
          colorMode={themeIsDark ? 'dark' : 'light'}
          className={[
            'ds-flow-wrap',
            snap ? 'snap-on' : '',
            animate ? '' : NO_ANIM,
            // K — DEFECT 3: the ONE hook the mode-specific CSS hangs off. It
            // goes on the flow wrapper (the element the canvas actually lives
            // in), NOT on `.app`, so a review-mode rule re-scopes against
            // exactly the subtree it means. Same shape as NO_ANIM above.
            readOnly ? READ_ONLY : '',
          ].filter(Boolean).join(' ')}
          // K — DEFECT 2 / 3: bind React Flow's node-wrapper class to the SAME
          // token the CSS and this file already use. In review mode that token
          // is what RF reads back (`event.target.closest('.nopan')` in its
          // pan-zoom filter) to refuse a pan whose gesture began on a node.
          // Outside review mode `undefined` hands the decision back to RF's own
          // default ('nopan', which RF applies itself to every draggable node),
          // so edit mode is byte-for-byte what it was and node drags are
          // untouched. `panOnDrag` below is deliberately NOT part of this.
          noPanClassName={readOnly ? NO_PAN : undefined}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
          // ---- Part B: read-only review mode ---------------------------------
          // Every element-touching gesture is switched off through React Flow's
          // OWN props, so nothing is re-implemented. `panOnDrag` (below) is left
          // alone — panning is the whole point of the mode.
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable={!readOnly}
          /* CONFIG ROUND (2026-10-23) — the LIVE prop follows the Setting
             (Canvas → Layer display). 'manual' = paint order is the stored
             zIndex, WYSIWYG; 'basic' = the library's select-raises default. */
          zIndexMode={zIndexMode}
          snapToGrid={snap}
          snapGrid={[gridSize, gridSize]}
          onNodeDragStart={(e, node, nodesAll) => { startInteraction(); onNodeDragStartAll(e, node); void nodesAll; }}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={(e, node, nodesAll) => { endInteraction(); onNodeDragStop(e, node); void nodesAll; }}
          onNodeContextMenu={(e, node) => {
            e.preventDefault();
            if (readOnly) return;
            setCtx({kind: 'node', id: node.id, x: e.clientX, y: e.clientY});
          }}
          onEdgeContextMenu={(e, edge) => {
            e.preventDefault();
            if (readOnly) return;
            setCtx({kind: 'edge', id: edge.id, x: e.clientX, y: e.clientY});
          }}
          /* ROUND AK, AK-13 — a double-click on the connector creates a label at
             that point (or, when it landed on the existing label, the label's own
             handler has already caught it — see `onEdgeDoubleClick`). */
          onEdgeDoubleClick={onEdgeDoubleClick}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            // Part B: the pane menu is inert in review mode too. It is not a
            // harmless menu — paste, add-node and auto-layout all mutate the
            // board, so leaving it live would break the "nothing can be
            // touched" promise from the one surface that looks safest. The
            // right-click is swallowed (default prevented) and nothing opens;
            // the browser's own menu is NOT surfaced, because that would be a
            // new, unrelated UI in a mode meant to have none.
            if (readOnly) return;
            setCtx({kind: 'pane', x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY});
          }}
          onMoveStart={() => { setCtx(null); startInteraction(); }}
          onMoveEnd={endInteraction}
          onDoubleClick={(e) => {
            // Part B: review mode takes no canvas gesture at all — the insert
            // palette must not open from a double-click while read-only.
            if (readOnly) return;
            // D1: only open the insert palette on EMPTY canvas —
            // double-clicking a node or edge never triggers it.
            const t = e.target as HTMLElement;
            if (t.closest('.react-flow__node') || t.closest('.react-flow__edge')) return;
            if (!rf || !wrap.current) return;
            /* AQ18 — raw client coords (see the palette onDrop note): the extra
               wrap subtraction landed the search palette up-left of the click. */
            setSearchPos(rf.screenToFlowPosition({x: e.clientX, y: e.clientY}));
          }}
          onSelectionChange={({nodes: s, edges: se}) => {
            setSel(s[0]?.id ?? null);
            setSelCount(s.length);
            setSelEdgeId(se.length === 1 ? se[0].id : null);
          }}
          fitView fitViewOptions={{padding: 0.25, maxZoom: 1}}
          minZoom={0.2} maxZoom={2.5}
          // M3/S3.7 — KEEP false. React Flow's own warning: double-click zoom
          // bypasses the gesture filter entirely (no `isWrappedWithClass` guard
          // on `dblclick.zoom`, unlike `wheel`/`pointerdown`), so leaving it on
          // would fire `dblclick.zoom` on the current selection. Double-tap is
          // also our insert palette via the `onDoubleClick` handler below.
          zoomOnDoubleClick={false}
          // M3/S3.2 — KNOWN REACT FLOW TRAP, do not "simplify" this back to a
          // bare button array. `panOnDrag`'s array form constrains the MOUSE
          // only. Pane's own `onPointerDownCapture` (dist/esm/index.js:1481)
          // early-returns for `event.pointerType === 'touch'` whenever
          // `panOnDrag !== false` and no selection key is held — so a finger
          // can never reach the `selectionOnDrag` branch. DECISION: on a coarse
          // pointer one finger on the empty pane PANS (what a mobile user
          // expects); two fingers pan + pinch-zoom via `zoomOnPinch`. Box-select
          // therefore stays a mouse-only gesture (left-drag) or an explicit
          // Shift-drag on a hybrid device.
          //
          // ROUND AA, ITEM 2 — THE GESTURE ARRANGEMENT, RESTATED, and it is
          // UNCHANGED: `panOnDrag` is still `[1, 2]` in edit mode, so a plain
          // LEFT-drag (button 0) is NOT a pan; `selectionOnDrag={!readOnly}`
          // is what claims button 0 on the empty pane and draws the marquee.
          // Panning stays on middle/right drag plus `panOnScroll` (free, both
          // axes) and Space-drag. Left-drag PAN was never the behaviour and is
          // still not: making it so would trade Harvey's box-select for a pan
          // he did not ask for.
          //
          // `panOnDrag` is `!== false` in BOTH branches, which is what keeps
          // the touch path alive: on a finger, `onPointerDownCapture` takes the
          // early return at :1481 BEFORE the `isSelectionActive` test at :1491,
          // so the gesture falls through to the pan-zoom filter and one finger
          // pans. `readOnly ? true : [1, 2]` never changes that — `true` and a
          // two-element array are both `!== false`.
          //
          // READ-ONLY BRANCH — do NOT collapse this ternary back to a literal
          // array. In review mode `selectionOnDrag` is `false` AND the array
          // form here would exclude button 0, so a plain LEFT-drag on the pane
          // would match no branch at all and be a DEAD gesture (measured defect:
          // the viewport does not move). Harvey's ask was literally a
          // back-and-forth left-drag that touches no element, so in review mode
          // ANY button pans: `true`. Outside review mode the value is still
          // `[1, 2]`. A left-drag here can never select: selection needs
          // `elementsSelectable` to be true (see `elementsSelectable={!readOnly}`
          // above), so no box-select / node toolbar / resize handle can appear.
          panOnDrag={readOnly ? true : [1, 2]}
          selectionOnDrag={!readOnly}
          // ROUND AA, ITEM 2(a)/(b) — THE MARQUEE MODE. React Flow's own default
          // is `SelectionMode.Full` (`@xyflow/system`: `enum SelectionMode {
          // Partial = 'partial', Full = 'full' }`), and `Pane` passes
          // `selectionMode === SelectionMode.Partial` as `getNodesInside`'s
          // `partially` flag — so with no prop the marquee had to CONTAIN a node
          // to select it. That was the measured defect: a box missing 60px on a
          // node's right edge, or covering only its left half, selected nothing.
          // The prop now READS THE SETTING (`useMarqueeMode` above), whose
          // no-write default is `touch` -> `SelectionMode.Partial` (overlap),
          // matching Figma / Excalidraw / draw.io / tldraw. Changing the setting
          // re-renders this prop live; no reload.
          selectionMode={selectionMode}
          selectionKeyCode={['Shift']}
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Free}
          zoomOnScroll={false}
          zoomOnPinch
          zoomActivationKeyCode={['Meta', 'Control']}
          // M3/S3.3 — a raised drag threshold is what keeps a PRESS a press.
          // 6px on coarse pointers (a fingertip rolls 5–10px on a tap); 4px on
          // a fine pointer, because React Flow's 1px default converts an
          // ordinary hand-tremor click into a drag and swallows the click.
          // Connection drags keep 1px — see FINE_CONNECTION_DRAG_THRESHOLD_PX.
          //
          // `nodeClickDistance` MUST travel with `nodeDragThreshold` — it is
          // the SECOND gate on the same press, and a mismatch between the two
          // opens a DEAD BAND in `(clickDistance, dragThreshold]` where the
          // click is suppressed AND the drag never starts (measured: 2/3/4px
          // of travel did nothing at all). The reasoning, the exact d3-drag /
          // @xyflow source lines and the both-directions failure modes are
          // documented on the constants in `src/touch.ts`; the invariant is
          // machine-checked by `checks/node-click-distance.harness.mjs`.
          nodeDragThreshold={ui.isTouchScreen ? COARSE_DRAG_THRESHOLD_PX : FINE_DRAG_THRESHOLD_PX}
          nodeClickDistance={ui.isTouchScreen ? COARSE_NODE_CLICK_DISTANCE_PX : FINE_NODE_CLICK_DISTANCE_PX}
          connectionDragThreshold={ui.isTouchScreen ? COARSE_DRAG_THRESHOLD_PX : FINE_CONNECTION_DRAG_THRESHOLD_PX}
        >
          {/* L3c: hand-authored crow's-foot markers (React Flow has no custom
              marker primitives) — rendered here so `url(#…)` resolves. */}
          {crowKeys.length > 0 && <CrowFootDefs keys={crowKeys} />}
          <Background color="var(--dots)" gap={gridSize} size={1} />
          {/* Empty state — ITEM 2: shown only once the board load has RESOLVED
              and the board really has no nodes. `boardLoaded` is what stops a
              load in flight from claiming "This board is empty" over a canvas
              whose content is merely still on its way. */}
          {/* Empty state — ITEM 2: shown only once the board load has RESOLVED
              and the board really has no nodes. `boardLoaded` is what stops a
              load in flight from claiming "This board is empty" over a canvas
              whose content is merely still on its way.
              ROUND BN-3 PHASE B: the panel body lives in
              src/components/CanvasEmptyPanel.tsx; the GATE stays here
              (boot-no-flash pins it to App.tsx). */}
          <CanvasEmptyPanel show={boardLoaded && nodes.length === 0} />
          {/* ROTATE-FIX: hands the store's updateNodeInternals up (the hook
              needs a provider ancestor; App is above <ReactFlow>). */}
          <RotateInternalsBridge onReady={u => { rotateInternals.current = u; }} />
          {/* GROUP-ROTATE: the ONE shared rotate grip for a multi-selection,
              above-centre of the selection union box (it must be a <ReactFlow>
              child: it reads the store's live nodes/transform to place itself
              in screen space). Sole selection keeps the per-node RotateGrip. */}
          {!readOnly && selCount >= 2 && (
            <GroupRotateGrip onGesture={onGroupRotateGesture} />
          )}
          {/* SELBOX: the app's rotation-aware multi-selection box — RF's own
              rect unions UNROTATED internals (no override prop) and lags a
              rotated group; ours unions rotatedExtent in RF's selection
              vocabulary, RF's rect is paint-hidden (styles.css), paint-only. */}
          {selCount >= 2 && (
            <SelectionBox />
          )}
          {/* F3: helper lines. `HelperLinesView` portals itself into React
              Flow's viewport (`ViewportPortal`), so it must stay a direct child
              of <ReactFlow> — it does its own flow-coord placement there. */}
          {(guides.vertical || guides.horizontal) && <HelperLinesView guides={guides} />}
          <Controls showInteractive={false} />
          <ZoomPill />
          <MiniMap
            pannable zoomable
            style={{background: 'var(--surface)', border: '1px solid var(--border)'}}
            maskColor="var(--minimap-mask)"
            nodeColor={n => resolveColor(n.data as any)}
          />
        </ReactFlow>
      </main>

      {/* RIGHT — inspector */}
      <aside className="panel right">
        <div className="panel-head">
          <div className="sec-label" style={{margin: 0}}>Inspector</div>
        </div>
        <div className="panel-body">
          {edgeMode ? (
            <>
              {/* ROUND Y, ITEM 3 — THE `edge` BADGE IS GONE. It stated the KIND
                  of the selection, and the sections underneath now state it
                  better: Label / Line / Markers (+ Cardinality on an ERD, then
                  Flow) is a vocabulary NO node target renders (a goblin gets
                  Content / Text / Style, a table Table / Columns / Show mode).
                  A badge that repeats what the body below it already proves is
                  a row of the panel spent on nothing, so the badge AND its
                  trailing 12px spacer are both deleted — the spacer's only
                  tenant was the badge. */}
              {(() => { secBody('label', <>
                <div className="field">
                  <label>label</label>
                  <input
                    value={(selectedEdge!.label ?? '') as string}
                    placeholder="arrow name"
                    onChange={e => updateEdge({label: e.target.value})}
                  />
                </div>
                {/* ROUND AK, AK-8 — THE `intent label` BLOCK IS DELETED, WITH ITS
                    REASON. It was gated on `preset.edges.labelPresets?.length`,
                    i.e. on the BOARD's preset, so the row appeared on a C4 or
                    flowchart board and vanished elsewhere — regardless of which
                    edge was selected. Harvey asked exactly this ("tại sao sidebar
                    của line lại khác nhau ở mỗi type?"); the gate is gone AND the
                    field is gone, so there is no board-level fact left to key it
                    on. The `technology` input below STAYS: `technField` is a
                    different field with a live consumer (`GoblinEdge` renders
                    `d.techn` as a dim second line), and it is not a label list. */}
                {preset.edges.technField ? (
                  <div className="field">
                    <label>technology</label>
                    <input
                      value={(((selectedEdge!.data as any)?.techn ?? '') as string)}
                      placeholder="e.g. HTTPS/JSON, SMTP, Kafka"
                      onChange={e => updateEdge({data: {techn: e.target.value || undefined}})}
                    />
                  </div>
                ) : null}
                {/* ROUND AK, AK-3 — THE `label position` FIELD IS DELETED, WITH
                    ITS REASON. It offered a 3-button preset (center / start /
                    end) for a value the panel was ALREADY able to set by drag,
                    which is the confusion to avoid: draw.io ships a 9-way
                    `Position` dropdown that its own renderer IGNORES for edges
                    (its manual concedes it anchors to the diamond, not the
                    connector). Centre is reachable by dragging near the middle,
                    so the preset list carried no capability the drag did not.

                    THE STORED FIELD IS UNTOUCHED. `data.offset` is still read by
                    `GoblinEdge.tsx:383`, so a board that already carries
                    `start`/`end` renders exactly as it did — this deletes the
                    CONTROL, not the value. (`pass 2 / AK-10 replaces the preset
                    with the free 2-D drag the field was duplicating.) */}

                {/* ROUND AK, AK-12 — THE LABEL PLATE, TWO ROWS: the control and
                    the reset.

                    THE CONTROL IS A FLAT 3-OPTION ROW, not a popover: three
                    options ≤ the cited threshold of 4 (the AK-6 note above), and
                    the kit's `ToggleRow` is the existing control — no new
                    component was invented. `None` is a real stored value here
                    (decision D2), which is why the table lists it rather than
                    expressing "no plate" as the absence of the key.

                    WHY A CLASS AND NOT A COLOUR. The renderer writes
                    `labelBgClass(...)` onto `.edge-label`, so the three states
                    are three rules in the sheet — no hex enters either file, and
                    a theme change repaints all three for free. React Flow's own
                    `labelBgStyle` would have been the wrong mechanism: it is
                    `EdgeText`'s SVG-`<rect>` API, and this label is a DOM `<div>`
                    through `EdgeLabelRenderer`. */}
                <div className="field">
                  <label>text color</label>
                  {swatchRow(eLabelTextKey, k => updateEdge({data: {labelTextKey: k}}))}
                </div>
                <div className="field">
                  <label>background</label>
                  {chipRow(LABEL_BG_OPTS, eLabelBg,
                    v => updateEdge({data: {labelBg: v as any}}), 'Label background')}
                </div>
                {/* AL-3 — the plate's COLOUR, shown only when there IS a plate.
                    At `none` there is nothing to colour, so the row is absent
                    rather than present-and-inert — the same rule the panel
                    applies to `count`/`speed` (AL-7). */}
                {eLabelBg !== 'none' && (
                  <div className="field">
                    <label>background color</label>
                    {swatchRow(eLabelBgKey, k => updateEdge({data: {labelBgKey: k}}))}
                  </div>
                )}
                {/* ROUND AK, AK-14.1 — `Reset label position`, ONE history step,
                    and a BUTTON rather than a right-click or a double-tap. Those
                    are desktop idioms: the double-tap already means "edit label"
                    after AK-13, and Miro had to add a separate touch variant of
                    its own reset, which is the tell that the desktop form does
                    not travel. Disabled while the label is already centred —
                    there is nothing to reset, and a step that changes nothing
                    must not push a history entry (`onCommitLabel`'s rule). */}
                <div className="field">
                  <button
                    type="button"
                    className="chip act"
                    disabled={!eLabelMoved}
                    title={eLabelMoved
                      ? 'Put the label back on the line’s centre (one undo step)'
                      : 'The label is already centred'}
                    onClick={resetLabelPos}
                  >
                    Reset label position
                  </button>
                </div>
              </>); return null; })()}
              {(() => { secBody('line', <>
                <div className="field">
                  <label>stroke color</label>
                  {swatchRow(
                    eStrokeKey,
                    setEdgeColor,
                    /* ROUND AO, AO-1c — the edge literal, stored on `data.color`
                       with `strokeKey` cleared and BOTH markers recoloured to the
                       literal (see `edgeColorLiteralPatch`). `resolveColorKey`
                       returns `null` for an arbitrary hex, so no hue lights and the
                       custom cell takes the ring. A literal cannot follow a theme —
                       that is stated in the code, not worked around. */
                    {value: (selectedEdge?.data as any)?.color, onPick: setEdgeColorLiteral},
                  )}
                </div>
                {/* ROUND AK, AK-6 — ONE FULL-WIDTH FLAT ROW PER CONTROL.

                    WAS: `stroke width` and `line style` inside a shared
                    `.field-row` (a 2-column grid, so each control got half the
                    panel), and `curvature` a lone `IconPickerRow` trigger +
                    popover. NOW: each owns its own `.field`, and each is a flat
                    `ToggleRow` — the existing control kit, not a new control.

                    WHY A ROW AND NOT A POPOVER — THE THRESHOLD, CITED.
                    tldraw states it in source: `items.length > 4 ? Grid : Row`
                    (`StylePanelButtonPicker.tsx#L152`), and Excalidraw behaves
                    identically (flat rows for 3-4, a popover for its 9-marker
                    set). MEASURED option counts here, not assumed:
                    `line style` 3, `curvature` 4 — both flat rows, as the rule
                    says. `stroke width` is 5 (`[1, 1.5, 1.8, 2, 3]`), so it is
                    the ONE set above the cited threshold; it is kept as a row
                    because the row still measures clean — 5 cells over the 253px
                    field with 5px gaps is a `(253 - 4*5) / 5 = 46.6px` cell and a
                    `46.6 - 16 - 2 = 28.6px` content box, which fits the 26px
                    `ArtWidth` glyph with 2.6px of slack — and because the brief
                    asks for it explicitly. THE COUNT DISCREPANCY IS REPORTED
                    RATHER THAN SILENTLY ABSORBED: the same brief states the width
                    set is 3 options; it is measured at 5.

                    WHY FLAT ROWS AT ALL, HONESTLY. "mature tools use button rows"
                    is TRUE for markers and FALSE for line style — draw.io uses a
                    `<select>` there. The defensible reason here is first-time-user
                    DISCOVERABILITY for a tool that will be shared: every option is
                    visible without opening anything. That is the claim; no false
                    precedent is cited.

                    EQUAL WIDTHS come from the existing `.insp-seg .insp-seg-btn
                    { flex: 1 1 0; min-width: 0 }` rule (the ROUND AA fix), so no
                    per-count arithmetic and no hard-coded pixel width is added
                    here. `checks/round-aa-align-marquee-palette.mjs` is the guard
                    that enumerates these call sites from the source. */}
                <div className="field">
                  <label>stroke width</label>
                  {chipRow(WIDTH_OPTS, eWidth,
                    v => updateEdge({style: {strokeWidth: Number(v)}}), 'Stroke width')}
                </div>
                <div className="field">
                  <label>line style</label>
                  {chipRow(DASH_ICON_OPTS, eDash,
                    v => updateEdge({style: {strokeDasharray: dashArray(v)}}), 'Line style', true)}
                </div>
                <div className="field">
                  <label>curvature</label>
                  {chipRow(CURVE_ICON_OPTS, ePathType, v => {
                    const id = v as PathType;
                    /* G: the chosen curvature becomes the default for the NEXT
                       edges drawn. The preference is persisted, never written
                       back onto other edges, and the control still shows
                       `ePathType` — the SELECTED edge — so an older bezier edge
                       keeps reading `bezier` while the default is `smoothstep`.
                       NOTHING HERE TOUCHES `bendX`/`bendY`: the picker sets
                       `edge.type` and calls `rememberEdgePath`, exactly as the
                       select it replaces did. */
                    updateEdge({type: PATH_TYPES[id]});
                    if (id !== 'custom') rememberEdgePath(id);
                  }, 'Curvature', true)}
                </div>
                {/* ROUND AK, AK-15 — `Reverse line direction` CLOSES THE `line`
                    SECTION, which is where draw.io ships it (Arrange → Reverse)
                    and where the path's own controls live: it re-points the path,
                    it does not move the label. Its labels swap WITH the ends —
                    the legacy fraction is mirrored `o → 1−o` so a label sitting
                    a quarter of the way along stays a quarter of the way along —
                    and the two handles travel with their nodes. All of that is
                    `edgeLabel.reverseEdgePatch`, exercised by the harness, so the
                    rule is not restated here. */}
                <div className="field">
                  <button
                    type="button"
                    className="chip act"
                    title="Swap the two ends: the labels swap with them, the path does not change"
                    onClick={() => reverseEdgeDir(selectedEdge!.id)}
                  >
                    Reverse line direction
                  </button>
                </div>
              </>); return null; })()}
              {/* ROUND AM, AM-2 — THE EDGE LABEL'S TEXT SECTION, registered in
                  the position `src/inspector.ts` gives it (`label → text →
                  line`), between the label's own naming/colour controls and the
                  line's. The ORDER is not decided here: `renderSections()` walks
                  `inspSections`, so moving this block would change nothing and
                  the one place to change the order stays the pure module.

                  THE BODY IS A CONST, NOT AN INLINE LITERAL, and it is
                  `edgeLabelTextBody` rather than `tsBody` because this target
                  offers SIZE / WEIGHT / FONT and NOT the colour or align rows —
                  the reasons are on that const. Registering `tsBody` here would
                  put a `text color` swatch row directly under the LABEL
                  section's own `text color` swatch row, i.e. two controls for one
                  stored fact, and an align row that would paint nothing because
                  `.edge-label` is an inline chip with no box to align inside. */}
              {(() => { secBody('text', edgeLabelTextBody); return null; })()}
              {(() => { secBody('markers', <>
              {/* ROUND AK, AK-5/AK-7 — THE TWO END CONTROLS.
                  RENAMED: `arrow head` → `start`, `head start` → `end`. The
                  labels were the defect, not the wiring: today's "arrow head" is
                  `markerEnd` and today's "head start" is `markerStart`, so the row
                  labels now match the values they write. Decision D3 chose
                  Start/End over "head start/head end" because no surveyed tool
                  uses "head" (tldraw uses `Start`/`End`), and the "Markers"
                  section title already supplies the context.
                  STORAGE KEYS ARE UNCHANGED: `markerStart` / `markerEnd` and
                  `markerFor()` are untouched — this is a string change only.

                  EACH IS NOW A FLAT 3-OPTION ROW (was an `IconPickerRow` trigger
                  + popover). 3 options ≤ the cited threshold of 4 (AK-6 note),
                  and `MARKER_OPTS` / `MARKER_OPTS_START` were already
                  `PickerOption[]` tables, so they are reused verbatim as row
                  options — `ArtArrow`'s `flip` variant supplies the mirrored
                  glyphs, so the start row still reads as the mirror of the end
                  row. This is the half where "mature tools use button rows" IS
                  true (draw.io puts its arrowheads in a row), and it is cited as
                  such. */}
              <div className="field">
                <label>start</label>
                {chipRow(MARKER_ICON_OPTS_START, eMarkerStart,
                  v => updateEdge({markerStart: markerFor(v, eStroke)}), 'Start marker', true)}
              </div>
              <div className="field">
                <label>end</label>
                {chipRow(MARKER_ICON_OPTS, eMarkerEnd,
                  v => updateEdge({markerEnd: markerFor(v, eStroke)}), 'End marker', true)}
              </div>
              </>); return null; })()}
              {(() => { secBody('flow', <>
                {/* ROUND AK, AK-16/AK-17 — ONE AXIS, FIVE NON-OVERLAPPING NAMES.
                    `Envelope` was REMOVED: it drew the same thing as `Icon` with
                    the `mail` glyph (both are an envelope travelling the line —
                    `FLOW_ICON_PATHS.mail` in src/GoblinEdge.tsx IS an envelope),
                    which is the duplication the owner reported. An edge that
                    already stored `flow:'event'` still animates: `migrateEdge`
                    folds it onto `icon` + `mail` on READ, so no board is
                    rewritten and the look does not change.

                    HONEST LIMIT, recorded in the code and not only in a report:
                    NO mature tool surveyed for this round ships a connector-wide
                    marching-ants animation — Miro, Lucidchart, Whimsical and
                    FigJam all have ZERO; tldraw's only related control is a
                    GLOBAL reduce-motion user preference; Excalidraw has no
                    element-level animation at all. So the research could prove
                    WHICH OPTIONS DUPLICATED and could NOT justify what to keep:
                    the five names below are the owner's product call, not a
                    precedent. The REMOVAL is the evidence-backed part. */}
                <div className="field">
                  <label>flow</label>
                  {chipRow(FLOW_OPTS, eFlow,
                    v => updateEdge({data: {flow: v === 'none' ? undefined : (v as any)}}),
                    'Flow animation', true)}
              </div>
              {/* ROUND AM, AM-5 — COUNT AND SPEED ON ONE ROW, and the speed is a
                  SLIDER. Two rows of ~50px collapse into one of ~44px:

                  * `count` keeps the `Stepper` (a 6-value ordinal has no
                    continuous form) but takes the new `compact` modifier, so it
                    stops stretching a 253px field to show one digit.
                  * `speed` was four word-chips — `slow / normal / fast / very
                    fast` — over a value the renderer already accepts
                    continuously (0.6…8s). It becomes a range input on exactly
                    that range; the four old chip values 4 / 2.4 / 1.4 / 0.8 all
                    live inside it, so no stored value is unreachable.

                  BOTH STAY GATED ON A PAYLOAD FLOW (AL-7): `dots` and `icon` are
                  the two flows that animate a bead, so they are the two that
                  have a count and a speed at all. `none` / `dash` / `pulse` are
                  line-level animations with no bead to count, and the gate is
                  untouched by this round.

                  ONE HISTORY ENTRY PER DRAG: `onGestureStart` pushes once (the
                  latch in `updateEdge`'s `coalesce` option — the same rule
                  `src/resizeHistory.ts` records for the resize grip), and every
                  `input` after it coalesces into that entry.

                  ROUND AO, AO-2 — AND IT PAYS THE 13px NOW. Collapsing two rows
                  into one is what created the defect this round: the pair is the
                  only row in the panel that is NOT a `.field`, so it never got
                  `.field`'s `margin-bottom: 13px` and the `flow glyph` row below it
                  started at the pair's own bottom edge — measured, a 0px box gap.
                  `.pair` carries the 13px itself now (see the rule in
                  `src/styles.css`); the pair's own children still lose theirs, which
                  is correct, the pair supplies that layout. */}
              {(eFlow === 'dots' || eFlow === 'icon') && (
                <div className="pair">
                  <div className="field">
                    <label>count</label>
                    <Stepper
                      value={eFlowCount}
                      onChange={n => updateEdge({data: {flowCount: n}})}
                      min={1} max={6}
                      title="Flow count"
                      compact
                    />
                  </div>
                  <div className="field grow">
                    <label>speed</label>
                    <FlowSpeed
                      value={eFlowSpeed}
                      onInput={secs => updateEdge({data: {flowDuration: secs}}, false, true)}
                      onGestureBoundary={() => { bendDragging.current = false; }}
                      title="Flow speed"
                    />
                  </div>
                </div>
              )}
              {/* ROUND AN, AN-4 — THE RAIL WAS DELETED HERE: it rendered
                  `<FlowRail seconds={eFlowSpeed} label={\`${eFlowCount} × …s per
                  loop\`}/>` whenever the flow was `dots` or `icon`. The owner
                  removed it ("tôi k cần cái Flow rail, xoá đi"), so no preview
                  is rendered and NONE SHOULD BE RE-ADDED: the speed's read-out
                  is the `.speedval` number inside `FlowSpeed` above, printed
                  from the same stored duration. */}
              {eFlow === 'icon' && (
                <div className="field">
                  <label>flow glyph</label>
                  {chipRow(FLOW_ICON_OPTS, eFlowIcon,
                    v => updateEdge({data: {flowIcon: v as any, flow: 'icon' as any}}), 'Flow glyph', true)}
                </div>
              )}
              {/* The ERD gate that used to sit here (`preset.id === 'erd' ? … :
                  null`) now lives in the DECISION (`src/inspector.ts` §A.3 writes
                  the Cardinality condition as `kind === 'edge' && preset.id ===
                  'erd'`), so a non-ERD edge never reaches this line: the section
                  is absent from `inspSections` and `secBody` is never called for
                  it. Keeping the gate here as well would be the second, divergent
                  copy of the same rule. §C additionally folds this section by
                  default; pass 1 renders it open. */}
              {hasSection('cardinality') && (() => { secBody('cardinality', <>
                  {/* ROUND AK, AK-5 — `source end` / `target end` RENAMED to the
                      SAME two words the Markers section now uses (`start` /
                      `end`), so the panel stops using three vocabularies for two
                      ends. Storage keys (`markerStart` / `markerEnd`) are
                      unchanged — a string change only.
                      These stay `IconPickerRow` (a popover): the crow's-foot set
                      is SIX options, above the cited flat-row threshold of 4
                      (AK-6 note), and 6 glyphs do not fit a 253px row legibly. */}
                  <div className="field-row">
                    <div className="field">
                      <label>start</label>
                      <IconPickerRow
                        id="insp-card-start"
                        value={(((selectedEdge!.markerStart as any)?.type ?? 'none') as string)}
                        onChange={v => {
                          updateEdge({markerStart: isCrowFoot(v)
                            ? ({type: v, color: eStroke, width: 18, height: 12} as any)
                            : (v === 'none' ? undefined : ({type: v as MarkerType, color: eStroke, width: 14, height: 14} as any))});
                        }}
                        options={CROW_START_OPTS}
                        title="Cardinality: start"
                      />
                    </div>
                    <div className="field">
                      <label>end</label>
                      <IconPickerRow
                        id="insp-card-end"
                        value={(((selectedEdge!.markerEnd as any)?.type ?? 'none') as string)}
                        onChange={v => {
                          updateEdge({markerEnd: isCrowFoot(v)
                            ? ({type: v, color: eStroke, width: 18, height: 12} as any)
                            : (v === 'none' ? undefined : ({type: v as MarkerType, color: eStroke, width: 14, height: 14} as any))});
                        }}
                        options={CROW_END_OPTS}
                        title="Cardinality: end"
                      />
                    </div>
                  </div>
                  <div className="hint" style={{paddingTop: 2}}>
                    Derived: <b>{cardinalityLabel((selectedEdge!.markerStart as any)?.type, (selectedEdge!.markerEnd as any)?.type) || '—'}</b>
                  </div>
              </>); return null; })()}
              {/* ROUND AK, AK-4 — THE ORPHAN `animated (dash on the line)` FIELD
                  IS DELETED. It sat OUTSIDE every section (no `secBody`, so it
                  rendered as a loose row under Flow Animation) and drew the SAME
                  marching-dash effect as the Flow Animation picker's `Dash`
                  option — two controls, one effect. `flow: 'dash'` is the one
                  that survives. An edge that had persisted `animated: true` keeps
                  its look: `migrateEdge` (App.tsx, AK-4 note) maps it to
                  `flow: 'dash'` on read. See that note for the measurement that
                  nothing in `boards/` ever set it true. */}
              </>); return null; })()}
              {/* K3: the payload-animation control moved to Settings → Canvas
                  ("Reduce motion"), where the preference belongs; the state and
                  its persisted override stay in useAnimationGating. */}
              {/* ROUND AK, AK-2 — THE SIDEBAR HINT IS DELETED.
                  It read "Double-click the label on the canvas to rename it
                  (Enter commit · Esc cancel). Every change is undoable with
                  ⌘/Ctrl Z." — four sentences of instructions standing where a
                  control belongs. draw.io's live edge Format panel contains ZERO
                  sentence-length strings; the controls themselves carry the
                  affordance (`.edge-label`'s own `title` already says
                  "Double-click to rename this connection"), and the keyboard
                  contract is on the shortcuts sheet (`?`). */}
              {renderSections()}
            </>
          ) : selCount >= 2 ? (
            <>
              {/* C2: multi-select summary — never a single node's fields.
                  ROUND BD redesigned this block (the decisions are pinned
                  by checks/round-bd-multi-panel.mjs); comment pruned
                  2026-10-26 for the ROUND ROTATE App budget. */}
              <div className="multi-head">{selCount} nodes selected</div>
              <div className="sec-label">Align</div>
              <div className="multi-actions multi-grid3">
                <button className="mbtn" title="Align left edges" aria-label="Align left" onClick={() => align('left')}><AlignStartVertical size={15} /></button>
                <button className="mbtn" title="Align horizontal centers" aria-label="Align horizontal centers" onClick={() => align('hcenter')}><AlignCenterVertical size={15} /></button>
                <button className="mbtn" title="Align right edges" aria-label="Align right" onClick={() => align('right')}><AlignEndVertical size={15} /></button>
                <button className="mbtn" title="Align top edges" aria-label="Align top" onClick={() => align('top')}><AlignStartHorizontal size={15} /></button>
                <button className="mbtn" title="Align vertical middles" aria-label="Align vertical middles" onClick={() => align('vcenter')}><AlignCenterHorizontal size={15} /></button>
                <button className="mbtn" title="Align bottom edges" aria-label="Align bottom" onClick={() => align('bottom')}><AlignEndHorizontal size={15} /></button>
              </div>
              <div className="sec-label">Distribute</div>
              <div className="multi-actions multi-grid2">
                <button className="mbtn" title="Distribute horizontally" aria-label="Distribute horizontally" onClick={() => distribute('h')}><AlignHorizontalSpaceAround size={15} /></button>
                <button className="mbtn" title="Distribute vertically" aria-label="Distribute vertically" onClick={() => distribute('v')}><AlignVerticalSpaceAround size={15} /></button>
              </div>
              <div className="sec-label">Arrange</div>
              <div className="multi-actions multi-grid2">
                <button className="mbtn" title="Bring to front" aria-label="Bring to front" onClick={() => reorderSelection('front')}><BringToFront size={15} /></button>
                <button className="mbtn" title="Send to back" aria-label="Send to back" onClick={() => reorderSelection('back')}><SendToBack size={15} /></button>
              </div>
              <div className="sec-label">Color</div>
              <div className="field">
                {(() => {
                  /* the batch's SHARED key, or null when the batch disagrees —
                     see the ROUND BD note at `swatchRow` above */
                  const keys = nodes.filter(n => n.selected).map(n => resolveColorKey(n.data as any));
                  const shared = keys.length && keys.every(k => k === keys[0]) ? keys[0] : null;
                  return swatchRow(shared, k => {
                    pushHistory();
                    const ids = new Set(nodes.filter(n => n.selected).map(n => n.id));
                    setNodes(ns => ns.map(n => ids.has(n.id)
                      ? {...n, data: {...(n.data as any), colorKey: k, color: undefined}}
                      : n));
                  });
                })()}
              </div>
              <div className="sec-label">Actions</div>
              <div className="multi-actions">
                <button className="mbtn" onClick={() => duplicateSelection()}>Duplicate</button>
                <button className="mbtn multi-danger" title="Delete selected nodes" onClick={deleteSelection}>Delete</button>
              </div>
            </>
          ) : selected?.type === 'table' ? (
            <>
              {/* ROUND Y, ITEM 3 — THE `table` BADGE IS GONE, same reason as the
                  edge's: Table / Columns / Show mode is the ERD vocabulary and
                  no other target renders it. The badge restated the target kind
                  the sections already name, so it went with its 12px spacer. */}
              {(() => { secBody('table', <>
              <div className="field">
                <label>name</label>
                <input
                  value={(((selected.data as any).name ?? '') as string)}
                  onChange={e => update({name: e.target.value} as any)}
                />
              </div>
              <div className="field">
                <label>schema (optional)</label>
                <input
                  value={(((selected.data as any).schema ?? '') as string)}
                  placeholder="public"
                  onChange={e => update({schema: e.target.value} as any)}
                />
              </div>
              <div className="field">
                <label>color (symbolic key)</label>
                {swatchRow(
                  resolveColorKey(selected.data as any),
                  k => update({colorKey: k, color: undefined} as any),
                  /* ROUND AO, AO-1c — a table node takes a literal exactly like a
                     goblin node does: same two keys, same inverse write. The label
                     above still says "symbolic key" because the KEY is what follows
                     a theme; the custom cell is the documented escape hatch from it. */
                  {value: (selected.data as any).color, onPick: hex => update({color: hex, colorKey: undefined} as any)},
                )}
              </div>
              </>); return null; })()}
              {(() => { secBody('columns', <>
              {((((selected.data as any).columns ?? []) as TableColumn[])).map((c, i) => (
                <div className="tcol-edit" key={c.id}>
                  <input
                    className="tcol-name"
                    value={c.name}
                    aria-label={`column ${i + 1} name`}
                    onChange={e => update({
                      columns: ((selected.data as any).columns as TableColumn[]).map(x =>
                        x.id === c.id ? {...x, name: e.target.value} : x),
                    } as any)}
                  />
                  <input
                    className="tcol-type"
                    value={c.type}
                    aria-label={`column ${i + 1} type`}
                    onChange={e => update({
                      columns: ((selected.data as any).columns as TableColumn[]).map(x =>
                        x.id === c.id ? {...x, type: e.target.value} : x),
                    } as any)}
                  />
                  <div className="tcol-flags">
                    {([['pk', 'PK'], ['fk', 'FK'], ['notNull', 'NN'], ['unique', 'U']] as const).map(([f, lbl]) => (
                      <button
                        key={f}
                        type="button"
                        className={`mbtn${(c as any)[f] ? ' on' : ''}`}
                        style={(c as any)[f] ? {borderColor: 'var(--sel)', color: 'var(--sel)'} : undefined}
                        title={lbl}
                        onClick={() => update({
                          columns: ((selected.data as any).columns as TableColumn[]).map(x =>
                            x.id === c.id ? {...x, [f]: !(x as any)[f]} : x),
                        } as any)}
                      >{lbl}</button>
                    ))}
                    <button
                      type="button"
                      className="mbtn danger"
                      title="Remove this column"
                      onClick={() => update({
                        columns: ((selected.data as any).columns as TableColumn[]).filter(x => x.id !== c.id),
                      } as any)}
                    >×</button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="mbtn"
                onClick={() => update({
                  columns: [...(((selected.data as any).columns ?? []) as TableColumn[]),
                    {id: `c${idc++}`, name: 'new_column', type: 'text'}],
                } as any)}
              >+ add column</button>
              </>); return null; })()}
              {(() => { secBody('showMode', <>
                <div className="field">
                <div className="swatches" style={{gap: 6}}>
                  {([['ALL_FIELDS', 'All'], ['KEY_ONLY', 'Keys'], ['TABLE_NAME', 'Names']] as const).map(([v, lbl]) => (
                    <button
                      key={v}
                      className={`mbtn${showMode === v ? ' on' : ''}`}
                      style={showMode === v ? {borderColor: 'var(--sel)', color: 'var(--sel)'} : undefined}
                      onClick={() => setShowMode(v)}
                    >{lbl}</button>
                  ))}
                </div>
              </div>
              </>); return null; })()}
              <div className="hint">
                FK edges attach column-to-column — drag from a column's left dot to the
                referenced column. Crow's feet show the cardinality.
              </div>
              {renderSections()}
            </>
          ) : !selected ? (
            <div className="empty">
              No selection.<br />Click a node to edit its fields, or click an edge (the arrow)
              to edit its label, stroke and arrow heads.
            </div>
          ) : selected.type === 'label' ? (
            <>
              {/* ROUND Y, ITEM 3 — THE `label` BADGE IS GONE, and this is the one
                  Harvey pointed at ("cái label ở top có cần ko?"). A label target
                  holds exactly ONE section, `text`, so the badge read `label`
                  directly above a header that reads `Text` — it told the user
                  nothing they could not see, and it pushed the section down.
                  Badge and spacer both deleted. */}
              {/* PACKAGE-P §E.3(a) — THE PANEL'S SECOND TEXT WRITER IS GONE.
                  This branch used to register a 4-row <textarea> as its `text`
                  section, i.e. a SECOND writer for the same `text` the in-place
                  editor on the canvas writes (`src/nodes/LabelNode.tsx`). §E.3 removes
                  it in the same pass that lands its replacement, so the two can
                  never be out of step. `text` now registers the SAME Text
                  section a goblin gets (one body, one writer, two targets), and
                  this kind has exactly ONE text editor: the in-place one that a
                  double-click opens on the node itself. The section is not an
                  empty shell — it carries size / weight / colour / align, which
                  is what that editor's text is painted with, and its controls
                  are usable WHILE the editor is open (§E.3(b) holds the
                  blur-commit while the pointer is inside this panel). */}
              {(() => { secBody('text', tsBody); return null; })()}
              {renderSections()}
            </>
          ) : (
            <>
              {/* ROUND Y, ITEM 3 — THE GOBLIN SHAPE BADGE IS GONE. It printed the
                  SHAPE's machine name (`service`, `queue`, `note`…) above the
                  panel, and the Style section's own shape picker already names
                  that same shape in the same panel — the trigger reads out
                  `current.label` (InspectorPicker' `icon-trigger-name`), so the
                  badge was a second, less readable copy of the control's own
                  readout. Nothing is disambiguated by it: a goblin's sections
                  (Content / Text / Style) name the target kind the same way they
                  do for every other kind. Deleted with its 12px spacer.

                  THE C4 CHIP STAYS AND IS THE ONE SURVIVOR — it is not a kind
                  label. `{C4[...].kicker}` states the node's C4 ROLE (`Person`,
                  `Container`, `System`…) which NOTHING else in this panel or on
                  the node's own card prints. The spacer became PART of that
                  conditional, because with the shape badge gone the chip is now
                  the only reason the spacer has to exist. */}
              {preset.id === 'c4' && isC4Type((selected.data as any).c4Type) && (
                <>
                  <span className="badge preset">
                    {C4[(selected.data as any).c4Type as keyof typeof C4].kicker}
                  </span>
                  <div style={{height: 12}} />
                </>
              )}
              {preset.note && <div className="preset-warn" style={{padding: '0 0 10px'}}>{preset.note}</div>}
              {(() => { secBody('content', <>
                {hasKicker(inspTarget) && (
                  <div className="field">
                    <label>kicker</label>
                    <input
                      value={((selected.data as any).kicker ?? '') as string}
                      onChange={e => update({kicker: e.target.value} as any)}
                    />
                  </div>
                )}
                {/* ROUND AG2, ITEM 1 — ONE label is enough for a flowchart node,
                    the way Mermaid and draw.io model it, so `sub` is gated on the
                    same §A.2 field-predicate mechanism as the kicker, metric and
                    icon (`src/inspector.ts` — the ONE place the rule lives). The
                    predicate hides the FIELD only: a node that already carries a
                    `sub` still paints it. */}
                {(['title', 'sub'] as const).filter(f => f !== 'sub' || hasSub(inspTarget)).map(f => (
                  <div className="field" key={f}>
                    <label>{f}</label>
                    <input
                      value={((selected.data as any)[f] ?? '') as string}
                      onChange={e => update({[f]: e.target.value} as any)}
                    />
                  </div>
                ))}
                {hasMetric(inspTarget) && (
                  <div className="field-row">
                    <div className="field">
                      <label>metric</label>
                      <input
                        value={((selected.data as any).metric ?? '') as string}
                        onChange={e => update({metric: e.target.value} as any)}
                      />
                    </div>
                    <div className="field">
                      <label>unit</label>
                      <input
                        value={((selected.data as any).metricUnit ?? '') as string}
                        onChange={e => update({metricUnit: e.target.value} as any)}
                      />
                    </div>
                  </div>
                )}
              </>); return null; })()}
              {/* PACKAGE-P §E.1/§A.3 — the Text section, BETWEEN Content and
                  Style (the order is `src/inspector.ts`'s, not this file's).
                  `tsBody` is the one body both targets register: a goblin here,
                  a label in the branch above. */}
              {(() => { secBody('text', tsBody); return null; })()}
              {(() => { secBody('style', <>
                <div className="field">
                  <label>shape</label>
                  <ShapesPicker
                    value={asShape((selected.data as any).shape)}
                    onChange={v => update({shape: v as Shape} as any)}
                    color={resolveColor(selected.data as any)}
                  />
                </div>
                {/* ROUND ROTATE — the Rotation row lives in Rows.tsx
                    (RotationRow): App.tsx must carry no numeric input element
                    (a package-p invariant), and the row is presentational. */}
                <RotationRow
                  value={(((selected.data as any).rotation as number | undefined) ?? 0)}
                  onChange={v => update({rotation: v === 0 ? undefined : v} as any)}
                />
                {/* HARVEY 2026-10-14 — the cylinder's plain option: drops the two
                    inner arcs (database / storeddata only). A key choice keeps
                    this row's neighbour contract simple: clearing the shape back
                    to a non-cylinder leaves the flag stored but unread. */}
                {(() => {
                  const sh = asShape((selected.data as any).shape);
                  if (sh !== 'database' && sh !== 'storeddata') return null;
                  const on = (selected.data as any).plainCylinder !== false;
                  return (
                    <div className="field">
                      {/* HARVEY-CHOSEN LABEL — "Details" generalises: other shapes
                          with optional inner lines (queue dividers, external dash)
                          can reuse the same Full/Minimal vocabulary. */}
                      <label>details</label>
                      <ToggleRow
                        value={on ? 'plain' : 'disks'}
                        onChange={v => update({plainCylinder: v === 'plain'} as any)}
                        options={[
                          {v: 'disks', label: 'Full', art: null},
                          {v: 'plain', label: 'Minimal', art: null},
                        ]}
                        title="Details: Full keeps the inner lines, Minimal draws a bare shape"
                      />
                    </div>
                  );
                })()}
                {/* §C READ LITERALLY. The two halves of the sentence are
                    "the `body` toggle sits behind the Style section's trigger
                    rather than occupying a full row" AND "One control folds, not
                    a section". The second half forbids folding Style itself —
                    which §A.3 already forbids (its collapsed-default is
                    `false`) and §F.4 confirms by listing Style among the OPEN
                    sections. So the fold is a SECOND-LEVEL disclosure INSIDE
                    Style: a `▸ body: card` trigger row that reveals the 2-way
                    toggle. Nothing is reordered; the shape picker, icon and
                    colour stay exactly where they were. The row's readout is the
                    CURRENT value, so the collapsed state still says what it
                    controls. Session-scoped open state: §C names ONE new
                    persisted key. */}
                {/* ROUND AI, ITEM 2 — the row is GATED on `hasBody`, not deleted.
                    A flowchart node has one centred label, so Harvey asked for
                    the `card` capability to go from the sixteen flowchart
                    shapes ("Với flowchart tôi nghĩ k cần dùng card!"). The gate
                    is the predicate, so there is no second shape list and no new
                    ad-hoc branch here; the DATA is untouched, so a flowchart node
                    already carrying `body: 'card'` keeps painting as a card. */}
                {hasBody(inspTarget) && (
                <div className="field">
                  <button
                    type="button"
                    className="field-toggle-trigger"
                    aria-expanded={bodyModeOpen}
                    aria-controls="insp-body-toggle"
                    onClick={() => setBodyModeOpen(o => !o)}
                  >
                    <span className="insp-sec-caret" aria-hidden="true">{bodyModeOpen ? '▾' : '▸'}</span>
                    <span className="field-toggle-label">
                      body: {(((selected.data as any).body ?? 'card') as string)}
                    </span>
                  </button>
                  {bodyModeOpen && (
                    <div id="insp-body-toggle">
                      <ToggleRow
                        value={(((selected.data as any).body ?? 'card') as string)}
                        onChange={v => update({body: v as 'card' | 'label-only'} as any)}
                        options={BODY_OPTS}
                        title="Body"
                      />
                    </div>
                  )}
                </div>
                )}
                {/* §A.2: `note` draws no IconGlyph, so the field is absent —
                    not disabled — for exactly that shape. */}
                {hasIcon(inspTarget) && (
                  <div className="field">
                    <label>icon</label>
                    <IconPicker
                      value={((selected.data as any).icon ?? '') as string}
                      onPick={name => update({icon: name ?? ''} as any)}
                    />
                  </div>
                )}
                <div className="field">
                  <label>color</label>
                  {swatchRow(
                    resolveColorKey(selected.data as any),
                    k => update({colorKey: k, color: undefined} as any),
                    /* ROUND AO, AO-1c — THE LITERAL PATH, THE EXACT INVERSE OF THE
                       KEY WRITE ABOVE. Picking a custom hex CLEARS the symbolic key
                       and stores `color`. `resolveColor` then returns the literal
                       (`isColorKey(colorKey)` is false, so it falls through to the
                       `d.color` branch) and `resolveColorKey` returns `null` for an
                       arbitrary hex, so no hue swatch lights and the custom cell
                       takes the `.on` ring instead. Picking any KEY afterwards runs
                       the key write, which clears `color` — that is the whole
                       "back to a theme colour" path, so no separate reset control
                       is needed. THEME HONESTY: a literal cannot follow a theme; a
                       custom colour stays exactly as chosen across a theme switch,
                       which is the honest consequence of choosing one. */
                    {value: (selected.data as any).color, onPick: hex => update({color: hex, colorKey: undefined} as any)},
                  )}
                </div>
                {/* ROUND AD, ITEM 5(a) — the colour-key note: visible,
                    dismissible (persisted key in src/colorKeyNote.ts),
                    one line, no focus steal. History pruned 2026-10-26
                    for the ROUND ROTATE App budget. */}
                {keyNoteShown && (
                  <div className="key-note" data-key-note="true">
                    <span className="key-note-text">{KEY_NOTE_TEXT}</span>
                    <span
                      className="key-note-x"
                      role="button"
                      tabIndex={0}
                      aria-label="Dismiss the color-key note"
                      title="Dismiss the color-key note"
                      onClick={dismissKeyNote}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          dismissKeyNote();
                        }
                      }}
                    >×</span>
                  </div>
                )}
              </>); return null; })()}
              {renderSections()}
            </>
          )}
        </div>
      </aside>
    </div>
    </div>
  );
}
