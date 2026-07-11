export type ExportAsset = {
  fileName: string;
  bytesBase64: string;
  mimeType: string;
};

export type ExportResult = {
  html: string;
  css: string;
  frameWidth: number;
  frameHeight: number;
  assets: ExportAsset[];
};

export type ExportMessage =
  | { type: 'export' }
  | { type: 'cancel' }
  | { type: 'set-pref'; key: 'skipExportChecklist'; value: boolean }
  | { type: 'get-prefs' };

export type ExportNode = { html: string };

export type ExportAssetInternal = {
  fileName: string;
  bytes: Uint8Array;
  mimeType: string;
};

export type ExportContext = {
  nameCounts: Map<string, number>;
  styleMap: Map<string, string>;
  utilityClasses: Set<string>;
  styleEntries: {
    className: string;
    baseName: string;
    suffix: number;
    cssText: string;
  }[];
  fontFamiliesUsed: Set<string>;
  usedBaseClasses: Set<string>;
  assets: ExportAssetInternal[];
  assetNameCounts: Map<string, number>;
  imageHashToFile: Map<string, string>;
  rootNode: SceneNode | null;
  rootHeight: number;
  isRootPass: boolean;
  progressDone: number;
  progressTotal: number;
  progressLastReportAt: number;
  imageTotal: number;
  imageDone: number;
};

/** Figma gradient paint (plugin API uses gradientTransform + gradientStops). */
export type FigmaGradientPaint = {
  type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND';
  gradientTransform: Transform;
  gradientStops: ReadonlyArray<{ position: number; color: RGBA }>;
  visible?: boolean;
  opacity?: number;
};

export type FigmaMaskType = 'ALPHA' | 'VECTOR' | 'LUMINANCE';

export type ParentGroupLike = {
  width: number;
  height: number;
  children: readonly SceneNode[];
  absoluteBoundingBox?: { x: number; y: number } | null;
};

export type ConvertNodeFn = (
  node: SceneNode,
  context: ExportContext,
  parentLayoutMode: FrameNode['layoutMode'] | null,
  parentFrame: FrameNode | null,
  parentGroup: GroupNode | FrameNode | null,
  indent: number,
  baseIndent: number,
  positionContainer?: SceneNode | null,
  flattenedZIndex?: number
) => Promise<ExportNode>;

export type ConvertParams = {
  node: SceneNode;
  context: ExportContext;
  parentLayoutMode: FrameNode['layoutMode'] | null;
  parentFrame: FrameNode | null;
  parentGroup: GroupNode | FrameNode | null;
  indent: number;
  baseIndent: number;
  positionContainer: SceneNode | null;
  flattenedZIndex: number;
  openPrefix: string;
  closePrefix: string;
  pascalName: string;
  baseName: string;
  dataLayer: string;
  convertNode: ConvertNodeFn;
};
