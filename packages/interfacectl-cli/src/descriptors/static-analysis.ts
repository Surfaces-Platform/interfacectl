import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { globby } from "globby";
import {
  type ChromeLayoutDescriptor,
  type ChromePolicyTarget,
  type ChromeShadowKind,
  type InterfaceContract,
  type SurfaceDescriptor,
  type SurfaceFontDescriptor,
  type SurfaceColorDescriptor,
  type SurfaceIconDescriptor,
  type SurfaceLayoutDescriptor,
  type SurfaceMotionDescriptor,
  type SurfaceSectionDescriptor,
  type PageFrameLayoutDescriptor,
  type LandingPatternDescriptor,
  type SurfacePrimitiveDescriptor,
  type SurfaceTokenDescriptor,
  type SurfaceTokenUsage,
  type SurfaceMarketingTypographyDescriptor,
  type SurfaceMarketingTypographyRoleDescriptor,
  type MarketingTypographyRole,
} from "@surfaces/interfacectl-validator";
import {
  collectTokenDefinitionsFromContent,
  normalizeObservedTokens,
  type RawObservedToken,
  type TokenDefinition,
} from "../utils/token-normalization.js";

const SECTION_ATTRIBUTE_REGEX =
  /data-(?:contract-)?section\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;

const CONTAINER_ATTRIBUTE_REGEX =
  /data-contract-container\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;
const MARKETING_LAYOUT_PROFILE_ATTRIBUTE_REGEX =
  /data-contract-marketing-layout-profile\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;
const HERO_CONTAINER_MODE_ATTRIBUTE_REGEX =
  /data-contract-hero-container-mode\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;
const HERO_VISUAL_PLACEMENT_ATTRIBUTE_REGEX =
  /data-contract-hero-visual-placement\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;
const SECTION_DIVIDER_MODE_ATTRIBUTE_REGEX =
  /data-contract-section-divider-mode\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;
const SECTION_SPACING_PROFILE_ATTRIBUTE_REGEX =
  /data-contract-section-spacing-profile\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;
const TYPOGRAPHY_PROFILE_ATTRIBUTE_REGEX =
  /data-contract-typography-profile\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;
const COPY_ROLE_ATTRIBUTE_REGEX =
  /data-contract-copy-role\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;
const CONTRACT_CONTAINER_TOKEN = "contract-container";
const PAGE_CONTAINER_ATTRIBUTE_REGEX =
  /data-contract\s*=\s*(?:"page-container"|'page-container'|{`page-container`}|{\s*["'`]page-container["'`]\s*})/g;
const CHROME_IGNORE_ATTRIBUTE_REGEX =
  /data-contract-chrome-ignore\s*=\s*(?:"true"|'true'|{true}|{\s*true\s*})/;
const MIN_SCREEN_CLASS_REGEX =
  /className\s*=\s*(?:"[^"]*\bmin-h-screen\b[^"]*\bw-full\b[^"]*"|'[^']*\bmin-h-screen\b[^']*\bw-full\b[^']*')/;
// Inline style extraction
const INLINE_STYLE_REGEX = /style\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;
const STYLE_OBJECT_ATTRIBUTE_REGEX = /\bstyle\s*=\s*{{([\s\S]*?)}}/;
const STYLE_STRING_ATTRIBUTE_REGEX =
  /\bstyle\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/;
const CLASSNAME_ATTRIBUTE_REGEX =
  /\bclass(?:Name)?\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/;
const INLINE_MAX_WIDTH_REGEX = /max-width\s*:\s*([0-9.]+)\s*px/gi;
const INLINE_MIN_WIDTH_REGEX = /min-width\s*:\s*([0-9.]+)\s*px/gi;
const INLINE_PADDING_LEFT_REGEX = /padding-left\s*:\s*([0-9.]+)\s*px/gi;
const INLINE_PADDING_RIGHT_REGEX = /padding-right\s*:\s*([0-9.]+)\s*px/gi;
const INLINE_PADDING_INLINE_REGEX = /padding-inline\s*:\s*([0-9.]+)\s*px/gi;
// CSS rule extraction for [data-contract="page-container"]
const CSS_SELECTOR_PAGE_CONTAINER_REGEX = /\[data-contract\s*=\s*["']page-container["']\]\s*\{([^}]+)\}/gi;
const CSS_MAX_WIDTH_REGEX = /max-width\s*:\s*([0-9.]+)\s*px/gi;
const CSS_MIN_WIDTH_REGEX = /min-width\s*:\s*([0-9.]+)\s*px/gi;
const CSS_PADDING_LEFT_REGEX = /padding-left\s*:\s*([0-9.]+)\s*px/gi;
const CSS_PADDING_RIGHT_REGEX = /padding-right\s*:\s*([0-9.]+)\s*px/gi;
const CSS_PADDING_INLINE_REGEX = /padding-inline\s*:\s*([0-9.]+)\s*px/gi;
// Tailwind class extraction (best-effort)
const TAILWIND_MAX_WIDTH_REGEX = /max-w-\[([0-9.]+)px\]/gi;
const TAILWIND_MIN_WIDTH_REGEX = /min-w-\[([0-9.]+)px\]/gi;
const TAILWIND_PADDING_X_REGEX = /px-\[([0-9.]+)px\]/gi;
const TAILWIND_PADDING_LEFT_REGEX = /pl-\[([0-9.]+)px\]/gi;
const TAILWIND_PADDING_RIGHT_REGEX = /pr-\[([0-9.]+)px\]/gi;
// Non-deterministic value detection
const CLAMP_REGEX = /clamp\s*\(/i;
const CALC_REGEX = /calc\s*\(/i;
// Optional CSS custom properties (fallback)
const PAGE_FRAME_MAX_WIDTH_VAR_REGEX =
  /--contract-page-frame-max-width\s*:\s*([0-9.]+)\s*px/i;
const PAGE_FRAME_MIN_WIDTH_VAR_REGEX =
  /--contract-page-frame-min-width\s*:\s*([0-9.]+)\s*px/i;
const PAGE_FRAME_PADDING_VAR_REGEX =
  /--contract-page-frame-padding-x\s*:\s*([0-9.]+)\s*px/i;
const TAG_REGEX = /<\/?[A-Za-z][\w.:-]*\b[^>]*>/g;
const CSS_RULE_REGEX = /([^{}]+)\{([^{}]+)\}/g;
const CSS_CLASS_SELECTOR_REGEX = /\.([_a-zA-Z]+[\w-]*)/g;
const COMMON_GLOBBY_IGNORES = [
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/.turbo/**",
  "**/__tests__/**",
  "**/?(*.)+(spec|test).[tj]s?(x)",
];

const FONT_VAR_REGEX = /var\((--font-[a-z0-9-]+)\)/gi;
const FONT_FAMILY_REGEX = /font-family\s*:\s*([^;]+);/gi;
const COLOR_VAR_REGEX = /var\((--color-[a-z0-9-]+)\)/gi;
const COLOR_DECL_REGEX =
  /(?:color|background-color|background|border-color|border-top-color|border-right-color|border-bottom-color|border-left-color|outline-color|text-decoration-color|caret-color|column-rule-color)\s*:\s*([^;]+);/gi;
const MAX_WIDTH_VAR_REGEX =
  /--contract-max-width\s*:\s*([0-9.]+)\s*(px|rem|em)/i;
const MOTION_DURATION_VAR_REGEX =
  /--contract-motion-duration\s*:\s*([0-9.]+)\s*(ms|s)/i;
const MOTION_TIMING_VAR_REGEX =
  /--contract-motion-timing\s*:\s*([a-z-]+)\s*;/i;
const TRANSITION_DECL_REGEX = /transition[^:]*:\s*([^;]+);/gi;
const DURATION_DECL_REGEX = /(animation|transition)-duration\s*:\s*([^;]+);/gi;
const TIMING_DECL_REGEX =
  /(animation|transition)-timing-function\s*:\s*([^;]+);/gi;
const GENERIC_VAR_REGEX = /var\((--[a-z0-9-]+)\)/gi;
const TYPOGRAPHY_TOKEN_DECL_REGEX =
  /(?<![\w-])(font-size|line-height|letter-spacing|font-family)\s*:\s*([^;]+);/gi;
const LAYOUT_TOKEN_DECL_REGEX =
  /(?<![\w-])(margin(?:-[a-z-]+)?|padding(?:-[a-z-]+)?|gap|row-gap|column-gap|width|max-width|min-width|min-height|height|border-radius)\s*:\s*([^;]+);/gi;
const MOTION_TOKEN_DECL_REGEX =
  /(?<![\w-])(transition[^:]*|animation[^:]*|transition-duration|animation-duration|transition-timing-function|animation-timing-function)\s*:\s*([^;]+);/gi;
const JSX_TYPOGRAPHY_TOKEN_DECL_REGEX =
  /\b(fontSize|lineHeight|letterSpacing|fontFamily)\s*:\s*([^,}]+)/g;
const JSX_LAYOUT_TOKEN_DECL_REGEX =
  /\b(margin(?:Top|Right|Bottom|Left|Inline|InlineStart|InlineEnd|Block|BlockStart|BlockEnd)?|padding(?:Top|Right|Bottom|Left|Inline|InlineStart|InlineEnd|Block|BlockStart|BlockEnd)?|gap|rowGap|columnGap|width|maxWidth|minWidth|minHeight|height|borderRadius)\s*:\s*([^,}]+)/g;
const JSX_MOTION_TOKEN_DECL_REGEX =
  /\b(transition(?:Duration|TimingFunction)?|animation(?:Duration|TimingFunction)?)\s*:\s*([^,}]+)/g;

const NAV_REGEX = /<nav\b/gi;
const NAV_COMPONENT_REGEX = /<Navigation\b/g;
const HEADER_REGEX = /<header\b/gi;
const HEADER_COMPONENT_REGEX = /<Header\b/g;
const FOOTER_REGEX = /<footer\b/gi;
const FOOTER_COMPONENT_REGEX = /<Footer\b/g;
const ASIDE_REGEX = /<aside\b/gi;
const AUTH_SHELL_REGEX = /<(AuthLayout|AuthShell|AuthWrapper|SessionProvider)\b/gi;
const PRIMITIVE_PATTERNS: Array<{ role: string; regex: RegExp }> = [
  { role: "navigation", regex: NAV_REGEX },
  { role: "navigation", regex: NAV_COMPONENT_REGEX },
  { role: "header", regex: HEADER_REGEX },
  { role: "header", regex: HEADER_COMPONENT_REGEX },
  { role: "footer", regex: FOOTER_REGEX },
  { role: "footer", regex: FOOTER_COMPONENT_REGEX },
  { role: "sidebar", regex: ASIDE_REGEX },
  { role: "auth-shell", regex: AUTH_SHELL_REGEX },
];
const IMPORT_SOURCE_REGEX =
  /\bimport\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g;
const EXPORT_SOURCE_REGEX =
  /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+["'`]([^"'`]+)["'`]/g;
const SURFACES_UI_COMPONENT_PREFIX = "@surfaces/ui/components/";
const MODULE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".cjs",
  ".cts",
];
const INDEX_MODULE_BASENAMES = MODULE_EXTENSIONS.map(
  (ext) => `index${ext}`,
);
const ICON_LIBRARY_PATTERNS = [
  /^lucide-react$/,
  /^@heroicons\//,
  /^react-icons(?:\/|$)/,
  /^@tabler\/icons-react$/,
  /^@mui\/icons-material(?:\/|$)/,
  /^@phosphor-icons\//,
  /^phosphor-react$/,
  /^iconoir-react$/,
  /^remixicon-react$/,
  /^@fortawesome\//,
];
const RADIUS_TOKEN_MAP = new Map<string, number>([
  ["rounded-none", 0],
  ["rounded-sm", 2],
  ["rounded", 4],
  ["rounded-md", 6],
  ["rounded-lg", 8],
  ["rounded-xl", 12],
  ["rounded-2xl", 16],
  ["rounded-3xl", 24],
  ["rounded-full", Number.POSITIVE_INFINITY],
]);

export interface DescriptorIssue {
  surfaceId?: string;
  code: string;
  message: string;
  location?: string;
}

export interface CollectSurfaceDescriptorsOptions {
  workspaceRoot: string;
  contract: InterfaceContract;
  surfaceFilters: Set<string>;
  surfaceRootMap: Map<string, string>;
}

export interface CollectSurfaceDescriptorsResult {
  descriptors: SurfaceDescriptor[];
  warnings: DescriptorIssue[];
  errors: DescriptorIssue[];
}

export async function collectSurfaceDescriptors(
  options: CollectSurfaceDescriptorsOptions,
): Promise<CollectSurfaceDescriptorsResult> {
  const structuralDescriptors: SurfaceDescriptor[] = [];
  const warnings: DescriptorIssue[] = [];
  const errors: DescriptorIssue[] = [];

  for (const surface of options.contract.surfaces) {
    if (
      options.surfaceFilters.size > 0 &&
      !options.surfaceFilters.has(surface.id)
    ) {
      continue;
    }

    const surfaceRoot = resolveSurfaceRoot(
      options.workspaceRoot,
      surface,
      options.surfaceRootMap,
    );

    if (!(await pathExists(surfaceRoot))) {
      errors.push({
        surfaceId: surface.id,
        code: "surface.missing",
        message: `Surface "${surface.id}" expected at ${surfaceRoot} but directory was not found.`,
        location: surfaceRoot,
      });
      continue;
    }

  const descriptorResult = await extractSurfaceDescriptor(
    options.workspaceRoot,
    surfaceRoot,
    surface.id,
    surface,
  );

    structuralDescriptors.push(descriptorResult.descriptor);
    warnings.push(...descriptorResult.warnings);
    errors.push(...descriptorResult.errors);
  }

  return { descriptors: structuralDescriptors, warnings, errors };
}

function resolveSurfaceRoot(
  workspaceRoot: string,
  surface: InterfaceContract["surfaces"][number],
  surfaceRootMap: Map<string, string>,
): string {
  const configuredRoot = surfaceRootMap.get(surface.id);
  if (configuredRoot) {
    return path.resolve(workspaceRoot, configuredRoot);
  }
  return path.join(workspaceRoot, "apps", surface.id);
}

async function extractSurfaceDescriptor(
  workspaceRoot: string,
  surfaceRoot: string,
  surfaceId: string,
  surface?: InterfaceContract["surfaces"][number],
): Promise<{
  descriptor: SurfaceDescriptor;
  warnings: DescriptorIssue[];
  errors: DescriptorIssue[];
}> {
  const warnings: DescriptorIssue[] = [];
  const errors: DescriptorIssue[] = [];

  const sectionFiles = await globby(["app/**/*.{ts,tsx,js,jsx}"], {
    cwd: surfaceRoot,
    absolute: true,
    gitignore: true,
    ignore: COMMON_GLOBBY_IGNORES,
  });

  const fileContentCache = new Map<string, string>();

  const sections = await extractSections(
    sectionFiles,
    workspaceRoot,
    fileContentCache,
  );
  if (sections.length === 0) {
    warnings.push({
      surfaceId,
      code: "sections.none-detected",
      message: `No sections discovered for surface "${surfaceId}". Ensure elements include data-contract-section attributes.`,
    });
  }

  const layoutCssFiles = await globby(["app/**/*.css"], {
    cwd: surfaceRoot,
    absolute: true,
    gitignore: true,
    ignore: COMMON_GLOBBY_IGNORES,
  });

  const layoutResult = await extractLayout(
    layoutCssFiles,
    sectionFiles,
    workspaceRoot,
    fileContentCache,
    surface,
  );
  warnings.push(...layoutResult.warnings);
  const layout = layoutResult.layout;
  const fonts = await extractFonts(
    surfaceRoot,
    sectionFiles,
    workspaceRoot,
    fileContentCache,
  );
  if (fonts.length === 0) {
    const globalsPath = path.join(surfaceRoot, "app", "globals.css");
    warnings.push({
      surfaceId,
      code: "fonts.none-detected",
      message: `No fonts detected for surface "${surfaceId}". Verify font variables in layout.tsx or CSS font declarations.`,
      location: (await pathExists(globalsPath))
        ? path.relative(workspaceRoot, globalsPath)
        : undefined,
    });
  }

  const colors = await extractColors(
    surfaceRoot,
    layoutCssFiles,
    sectionFiles,
    workspaceRoot,
    fileContentCache,
  );
  if (colors.length === 0) {
    const globalsPath = path.join(surfaceRoot, "app", "globals.css");
    warnings.push({
      surfaceId,
      code: "colors.none-detected",
      message: `No colors detected for surface "${surfaceId}". Verify color variables or CSS color declarations.`,
      location: (await pathExists(globalsPath))
        ? path.relative(workspaceRoot, globalsPath)
        : undefined,
    });
  }

  const motion = await extractMotion(layoutCssFiles, workspaceRoot, fileContentCache);
  if (motion.length === 0) {
    warnings.push({
      surfaceId,
      code: "motion.none-detected",
      message: `No motion declarations detected for surface "${surfaceId}".`,
    });
  }

  const tokenUsage = await extractTokenUsage(
    layoutCssFiles,
    sectionFiles,
    workspaceRoot,
    fileContentCache,
  );
  warnings.push(...tokenUsage.warnings);
  const marketingTypography = await extractMarketingTypography(
    layoutCssFiles,
    sectionFiles,
    workspaceRoot,
    fileContentCache,
  );
  warnings.push(...marketingTypography.warnings);

  const primitives = await extractPrimitives(sectionFiles, workspaceRoot, fileContentCache);
  const { icons, warnings: iconWarnings } = await extractIconSources(
    surfaceRoot,
    workspaceRoot,
    fileContentCache,
    surfaceId,
  );
  warnings.push(...iconWarnings);

  const structuralSurfaceDescriptor: SurfaceDescriptor = {
    surfaceId,
    sections,
    fonts,
    colors,
    icons,
    tokenUsage: tokenUsage.tokenUsage,
    marketingTypography: marketingTypography.typography,
    layout,
    motion,
    primitives,
  };

  return { descriptor: structuralSurfaceDescriptor, warnings, errors };
}

async function extractSections(
  filePaths: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
): Promise<SurfaceSectionDescriptor[]> {
  const sections = new Map<string, SurfaceSectionDescriptor>();

  for (const filePath of filePaths) {
    const source = path.relative(workspaceRoot, filePath);
    const content = await readFileCached(filePath, fileContentCache);
    let match: RegExpExecArray | null;

    while ((match = SECTION_ATTRIBUTE_REGEX.exec(content)) !== null) {
      const id =
        match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
      if (!id) {
        continue;
      }

      if (!sections.has(id)) {
        sections.set(id, {
          id,
          source,
        });
      }
    }
  }

  return [...sections.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function extractFonts(
  surfaceRoot: string,
  sectionFiles: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
): Promise<SurfaceFontDescriptor[]> {
  const fontValues = new Map<string, SurfaceFontDescriptor>();

  const layoutPath = path.join(surfaceRoot, "app", "layout.tsx");
  if (await pathExists(layoutPath)) {
    const layoutContent = await readFileCached(layoutPath, fileContentCache);
    collectFontsFromContent(
      layoutContent,
      path.relative(workspaceRoot, layoutPath),
      fontValues,
    );
  }

  const globalsPath = path.join(surfaceRoot, "app", "globals.css");
  if (await pathExists(globalsPath)) {
    const globalsContent = await readFileCached(globalsPath, fileContentCache);
    collectFontsFromContent(
      globalsContent,
      path.relative(workspaceRoot, globalsPath),
      fontValues,
    );
  }

  for (const sectionFile of sectionFiles) {
    const content = await readFileCached(sectionFile, fileContentCache);
    collectFontsFromContent(
      content,
      path.relative(workspaceRoot, sectionFile),
      fontValues,
    );
  }

  return [...fontValues.values()].sort((a, b) =>
    a.value.localeCompare(b.value),
  );
}

async function extractColors(
  surfaceRoot: string,
  cssFilePaths: string[],
  sectionFiles: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
): Promise<SurfaceColorDescriptor[]> {
  const colorValues = new Map<string, SurfaceColorDescriptor>();

  const layoutPath = path.join(surfaceRoot, "app", "layout.tsx");
  if (await pathExists(layoutPath)) {
    const layoutContent = await readFileCached(layoutPath, fileContentCache);
    collectColorsFromContent(
      layoutContent,
      path.relative(workspaceRoot, layoutPath),
      colorValues,
    );
  }

  const globalsPath = path.join(surfaceRoot, "app", "globals.css");
  if (await pathExists(globalsPath)) {
    const globalsContent = await readFileCached(globalsPath, fileContentCache);
    collectColorsFromContent(
      globalsContent,
      path.relative(workspaceRoot, globalsPath),
      colorValues,
    );
  }

  for (const cssPath of cssFilePaths) {
    const cssContent = await readFileCached(cssPath, fileContentCache);
    collectColorsFromContent(
      cssContent,
      path.relative(workspaceRoot, cssPath),
      colorValues,
    );
  }

  for (const sectionFile of sectionFiles) {
    const content = await readFileCached(sectionFile, fileContentCache);
    collectColorsFromContent(
      content,
      path.relative(workspaceRoot, sectionFile),
      colorValues,
    );
  }

  return [...colorValues.values()].sort((a, b) =>
    a.value.localeCompare(b.value),
  );
}

async function extractLayout(
  cssFilePaths: string[],
  sectionFiles: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
  surface?: InterfaceContract["surfaces"][number],
): Promise<{
  layout: SurfaceLayoutDescriptor;
  warnings: DescriptorIssue[];
}> {
  let maxWidth: number | null = null;
  let layoutSource: string | undefined;
  const warnings: DescriptorIssue[] = [];

  for (const cssPath of cssFilePaths) {
    const cssContent = await readFileCached(cssPath, fileContentCache);
    const match = cssContent.match(MAX_WIDTH_VAR_REGEX);
    if (match) {
      const [, value, unit] = match;
      const numericValue = Number.parseFloat(value);
      if (Number.isFinite(numericValue) && unit.toLowerCase() === "px") {
        maxWidth = numericValue;
        layoutSource = path.relative(workspaceRoot, cssPath);
        break;
      }
    }
  }

  const containerSources = new Set<string>();
  const containers = new Set<string>();
  for (const filePath of sectionFiles) {
    const content = await readFileCached(filePath, fileContentCache);
    const detectedContainers = collectContainersFromContent(content);
    if (detectedContainers.size > 0) {
      for (const container of detectedContainers) {
        containers.add(container);
      }
      containerSources.add(path.relative(workspaceRoot, filePath));
    }
  }

  // Extract pageFrame layout if contract defines it
  let pageFrame: PageFrameLayoutDescriptor | undefined;
  if (surface?.layout.pageFrame) {
    pageFrame = await extractPageFrameLayout(
      cssFilePaths,
      sectionFiles,
      workspaceRoot,
      fileContentCache,
      surface.layout.pageFrame,
    );
  }

  let landingPattern: LandingPatternDescriptor | undefined;
  if (surface?.layout.landingPattern) {
    landingPattern = await extractLandingPattern(
      sectionFiles,
      workspaceRoot,
      fileContentCache,
    );
  }

  let chrome: ChromeLayoutDescriptor | undefined;
  if (surface?.type === "web") {
    const chromeResult = await extractChromeLayout(
      cssFilePaths,
      sectionFiles,
      workspaceRoot,
      fileContentCache,
      surface.id,
    );
    chrome = chromeResult.chrome;
    warnings.push(...chromeResult.warnings);
  }

  return {
    layout: {
      maxContentWidth: maxWidth,
      containers: [...containers].sort(),
      containerSources: [...containerSources].sort(),
      source: layoutSource,
      pageFrame,
      chrome,
      landingPattern,
    },
    warnings,
  };
}

interface ChromeTargetWrapper {
  targetType: ChromePolicyTarget;
  source: string;
  classNames: string[];
  sectionId?: string;
  containerMarkerValue?: string;
  hasContractContainerClass?: boolean;
  styleText?: {
    kind: "object" | "string";
    value: string;
  };
}

interface ChromeCssRule {
  selectors: string[];
  declarationText: string;
  source: string;
}

interface ChromeSignal<TValue> {
  type: "radius" | "shadow";
  source: string;
  value: TValue;
}

async function extractChromeLayout(
  cssFilePaths: string[],
  sectionFiles: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
  surfaceId: string,
): Promise<{
  chrome?: ChromeLayoutDescriptor;
  warnings: DescriptorIssue[];
}> {
  const wrappers: ChromeTargetWrapper[] = [];

  for (const filePath of sectionFiles) {
    const content = await readFileCached(filePath, fileContentCache);
    wrappers.push(
      ...collectChromeTargetWrappers(
        content,
        path.relative(workspaceRoot, filePath),
      ),
    );
  }

  if (wrappers.length === 0) {
    return {
      chrome: undefined,
      warnings: [],
    };
  }

  const cssRules: ChromeCssRule[] = [];
  for (const cssPath of cssFilePaths) {
    const cssContent = await readFileCached(cssPath, fileContentCache);
    cssRules.push(
      ...parseChromeCssRules(
        cssContent,
        path.relative(workspaceRoot, cssPath),
      ),
    );
  }

  const targets = new Set<ChromePolicyTarget>();
  const shadowKinds = new Set<ChromeShadowKind>();
  const sources = new Set<string>();
  let maxBorderRadiusPx: number | null = null;
  let ambiguousRadius = false;
  let ambiguousShadow = false;

  for (const wrapper of wrappers) {
    targets.add(wrapper.targetType);
    sources.add(wrapper.source);

    const inlineResult = parseChromeInlineSignals(wrapper.styleText, wrapper.source);
    const classResult = parseChromeClassSignals(wrapper.classNames, wrapper.source);
    ambiguousRadius = ambiguousRadius || inlineResult.ambiguousRadius || classResult.ambiguousRadius;
    ambiguousShadow = ambiguousShadow || inlineResult.ambiguousShadow || classResult.ambiguousShadow;

    const radiusSignals: Array<ChromeSignal<number>> = [
      ...inlineResult.radiusSignals,
      ...classResult.radiusSignals,
    ];
    const shadowSignals: Array<ChromeSignal<ChromeShadowKind>> = [
      ...inlineResult.shadowSignals,
      ...classResult.shadowSignals,
    ];

    for (const rule of cssRules) {
      if (!rule.selectors.some((selector) => selectorMatchesChromeWrapper(selector, wrapper))) {
        continue;
      }
      const cssResult = parseChromeCssSignals(rule);
      ambiguousRadius = ambiguousRadius || cssResult.ambiguousRadius;
      ambiguousShadow = ambiguousShadow || cssResult.ambiguousShadow;
      radiusSignals.push(...cssResult.radiusSignals);
      shadowSignals.push(...cssResult.shadowSignals);
    }

    for (const signal of radiusSignals) {
      sources.add(signal.source);
      if (maxBorderRadiusPx === null || signal.value > maxBorderRadiusPx) {
        maxBorderRadiusPx = signal.value;
      }
    }
    for (const signal of shadowSignals) {
      sources.add(signal.source);
      shadowKinds.add(signal.value);
    }
  }

  const warnings: DescriptorIssue[] = [];
  if (ambiguousRadius) {
    warnings.push({
      surfaceId,
      code: "chrome.radius-undetermined",
      message:
        `Chrome border radius could not be deterministically extracted for one or more portable chrome markers on surface "${surfaceId}".`,
    });
  }
  if (ambiguousShadow) {
    warnings.push({
      surfaceId,
      code: "chrome.shadow-undetermined",
      message:
        `Chrome shadow treatment could not be deterministically extracted for one or more portable chrome markers on surface "${surfaceId}".`,
    });
  }

  return {
    chrome: {
      targets: [...targets].sort(),
      maxBorderRadiusPx,
      shadowKinds: [...shadowKinds].sort(),
      source: [...sources].sort(),
      hasAmbiguousSignals: ambiguousRadius || ambiguousShadow || undefined,
    },
    warnings,
  };
}

function collectChromeTargetWrappers(
  content: string,
  source: string,
): ChromeTargetWrapper[] {
  const wrappers: ChromeTargetWrapper[] = [];
  const sectionStack: string[] = [];
  let match: RegExpExecArray | null;

  TAG_REGEX.lastIndex = 0;
  while ((match = TAG_REGEX.exec(content)) !== null) {
    const tag = match[0];
    const tagName = extractTagName(tag);
    if (!tagName) {
      continue;
    }
    if (tag.startsWith("</")) {
      for (let index = sectionStack.length - 1; index >= 0; index -= 1) {
        if (sectionStack[index] === tagName) {
          sectionStack.splice(index, 1);
          break;
        }
      }
      continue;
    }

    const sectionId = extractAttributeValue(tag, SECTION_ATTRIBUTE_REGEX);
    const containerMarkerValue = extractAttributeValue(tag, CONTAINER_ATTRIBUTE_REGEX);
    const classNames = extractClassNames(tag);
    const styleText = extractTagStyleText(tag);
    const isIgnored = hasChromeIgnoreAttribute(tag);
    const isSelfClosing = /\/>\s*$/.test(tag);
    const hasContractContainerClass = classNames.includes(CONTRACT_CONTAINER_TOKEN);
    const isPageContainer = hasPageContainerAttribute(tag);

    if (!isIgnored && isPageContainer) {
      wrappers.push({
        targetType: "page-container",
        source,
        classNames,
        styleText,
      });
    }

    if (!isIgnored && sectionId && sectionStack.length === 0) {
      wrappers.push({
        targetType: "top-level-section",
        sectionId,
        source,
        classNames,
        styleText,
      });
    }

    if (!isIgnored && (hasContractContainerClass || containerMarkerValue)) {
      wrappers.push({
        targetType: "layout-container",
        containerMarkerValue,
        hasContractContainerClass,
        source,
        classNames,
        styleText,
      });
    }

    if (sectionId && !isSelfClosing) {
      sectionStack.push(tagName);
    }
  }

  return wrappers;
}

function extractTagName(tag: string): string | undefined {
  const match = tag.match(/^<\/?([A-Za-z][\w.:-]*)\b/);
  return match?.[1];
}

function hasChromeIgnoreAttribute(tag: string): boolean {
  CHROME_IGNORE_ATTRIBUTE_REGEX.lastIndex = 0;
  return CHROME_IGNORE_ATTRIBUTE_REGEX.test(tag);
}

function hasPageContainerAttribute(tag: string): boolean {
  PAGE_CONTAINER_ATTRIBUTE_REGEX.lastIndex = 0;
  return PAGE_CONTAINER_ATTRIBUTE_REGEX.test(tag);
}

function extractClassNames(tag: string): string[] {
  const match = CLASSNAME_ATTRIBUTE_REGEX.exec(tag);
  CLASSNAME_ATTRIBUTE_REGEX.lastIndex = 0;
  const raw =
    match?.[1] ??
    match?.[2] ??
    match?.[3] ??
    match?.[4] ??
    "";
  if (!raw) {
    return [];
  }
  return raw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function extractTagStyleText(
  tag: string,
): ChromeTargetWrapper["styleText"] | undefined {
  const objectMatch = STYLE_OBJECT_ATTRIBUTE_REGEX.exec(tag);
  STYLE_OBJECT_ATTRIBUTE_REGEX.lastIndex = 0;
  if (objectMatch?.[1]) {
    return {
      kind: "object",
      value: objectMatch[1],
    };
  }

  const stringMatch = STYLE_STRING_ATTRIBUTE_REGEX.exec(tag);
  STYLE_STRING_ATTRIBUTE_REGEX.lastIndex = 0;
  const raw =
    stringMatch?.[1] ??
    stringMatch?.[2] ??
    stringMatch?.[3] ??
    stringMatch?.[4] ??
    "";
  if (!raw) {
    return undefined;
  }

  return {
    kind: "string",
    value: raw,
  };
}

function parseChromeInlineSignals(
  styleText: ChromeTargetWrapper["styleText"],
  source: string,
): {
  radiusSignals: Array<ChromeSignal<number>>;
  shadowSignals: Array<ChromeSignal<ChromeShadowKind>>;
  ambiguousRadius: boolean;
  ambiguousShadow: boolean;
} {
  const radiusSignals: Array<ChromeSignal<number>> = [];
  const shadowSignals: Array<ChromeSignal<ChromeShadowKind>> = [];
  let ambiguousRadius = false;
  let ambiguousShadow = false;

  if (!styleText) {
    return { radiusSignals, shadowSignals, ambiguousRadius, ambiguousShadow };
  }

  const body = styleText.value;
  if (styleText.kind === "object") {
    const radiusMatch = body.match(/\bborderRadius\s*:\s*([^,}]+)/);
    if (radiusMatch?.[1]) {
      const value = parseChromePxValue(radiusMatch[1]);
      if (value === undefined) {
        ambiguousRadius = true;
      } else {
        radiusSignals.push({ type: "radius", source, value });
      }
    }

    const shadowMatch = body.match(
      /\bboxShadow\s*:\s*([^,}]+(?:,(?!\s*[a-zA-Z0-9_]+\s*:)[^,}]+)*)/,
    );
    if (shadowMatch?.[1]) {
      const value = classifyDeterministicShadow(shadowMatch[1]);
      if (value === undefined) {
        ambiguousShadow = true;
      } else {
        shadowSignals.push({ type: "shadow", source, value });
      }
    }

    return { radiusSignals, shadowSignals, ambiguousRadius, ambiguousShadow };
  }

  const radiusDecl = body.match(/\bborder-radius\s*:\s*([^;]+)/i);
  if (radiusDecl?.[1]) {
    const value = parseChromePxValue(radiusDecl[1]);
    if (value === undefined) {
      ambiguousRadius = true;
    } else {
      radiusSignals.push({ type: "radius", source, value });
    }
  }

  const shadowDecl = body.match(/\bbox-shadow\s*:\s*([^;]+)/i);
  if (shadowDecl?.[1]) {
    const value = classifyDeterministicShadow(shadowDecl[1]);
    if (value === undefined) {
      ambiguousShadow = true;
    } else {
      shadowSignals.push({ type: "shadow", source, value });
    }
  }

  return { radiusSignals, shadowSignals, ambiguousRadius, ambiguousShadow };
}

function parseChromeClassSignals(
  classNames: string[],
  source: string,
): {
  radiusSignals: Array<ChromeSignal<number>>;
  shadowSignals: Array<ChromeSignal<ChromeShadowKind>>;
  ambiguousRadius: boolean;
  ambiguousShadow: boolean;
} {
  const radiusSignals: Array<ChromeSignal<number>> = [];
  const shadowSignals: Array<ChromeSignal<ChromeShadowKind>> = [];
  let ambiguousRadius = false;
  let ambiguousShadow = false;

  for (const className of classNames) {
    if (RADIUS_TOKEN_MAP.has(className)) {
      const value = RADIUS_TOKEN_MAP.get(className);
      if (value !== undefined && Number.isFinite(value)) {
        radiusSignals.push({ type: "radius", source, value });
      } else {
        ambiguousRadius = true;
      }
      continue;
    }

    const arbitraryRadiusMatch = className.match(
      /^rounded(?:-[trblsexy]{1,2})?-\[(.+)\]$/,
    );
    if (arbitraryRadiusMatch?.[1]) {
      const value = parseChromePxValue(arbitraryRadiusMatch[1]);
      if (value === undefined) {
        ambiguousRadius = true;
      } else {
        radiusSignals.push({ type: "radius", source, value });
      }
      continue;
    }

    if (className === "shadow-none") {
      shadowSignals.push({ type: "shadow", source, value: "none" });
      continue;
    }

    if (className === "shadow-inner") {
      shadowSignals.push({ type: "shadow", source, value: "inset" });
      continue;
    }

    if (
      className === "shadow" ||
      /^shadow-(xs|sm|md|lg|xl|2xl)$/.test(className) ||
      /^drop-shadow(?:-.+)?$/.test(className)
    ) {
      shadowSignals.push({ type: "shadow", source, value: "outer" });
      continue;
    }

    if (/^shadow-\[.+\]$/.test(className) || /^drop-shadow-\[.+\]$/.test(className)) {
      ambiguousShadow = true;
    }
  }

  return { radiusSignals, shadowSignals, ambiguousRadius, ambiguousShadow };
}

function parseChromeCssRules(
  content: string,
  source: string,
): ChromeCssRule[] {
  const rules: ChromeCssRule[] = [];
  let match: RegExpExecArray | null;

  CSS_RULE_REGEX.lastIndex = 0;
  while ((match = CSS_RULE_REGEX.exec(content)) !== null) {
    const selectorText = match[1]?.trim();
    const declarationText = match[2]?.trim();
    if (!selectorText || !declarationText) {
      continue;
    }

    const selectors = selectorText
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean);
    if (selectors.length === 0) {
      continue;
    }

    rules.push({
      selectors,
      declarationText,
      source,
    });
  }

  return rules;
}

function selectorMatchesChromeWrapper(
  selector: string,
  wrapper: ChromeTargetWrapper,
): boolean {
  const classMatches = [...selector.matchAll(CSS_CLASS_SELECTOR_REGEX)].map(
    (match) => match[1],
  );
  if (
    classMatches.length > 0 &&
    !classMatches.every((className) => wrapper.classNames.includes(className))
  ) {
    return false;
  }

  if (wrapper.targetType === "page-container") {
    const pageContainerSelector =
      selector.includes('[data-contract="page-container"]') ||
      selector.includes("[data-contract='page-container']") ||
      selector.includes("[data-contract=page-container]");
    if (pageContainerSelector) {
      return true;
    }
  }

  if (wrapper.targetType === "top-level-section") {
    const genericSection = selector.includes("[data-contract-section]");
    const specificSection =
      wrapper.sectionId &&
      (selector.includes(`[data-contract-section="${wrapper.sectionId}"]`) ||
        selector.includes(`[data-contract-section='${wrapper.sectionId}']`) ||
        selector.includes(`[data-contract-section=${wrapper.sectionId}]`));
    if (genericSection || specificSection) {
      return true;
    }
  }

  if (wrapper.targetType === "layout-container") {
    const contractContainerClassSelector =
      wrapper.hasContractContainerClass &&
      classMatches.includes(CONTRACT_CONTAINER_TOKEN);
    const genericContainerAttribute =
      wrapper.containerMarkerValue && selector.includes("[data-contract-container]");
    const specificContainerAttribute =
      wrapper.containerMarkerValue &&
      (selector.includes(`[data-contract-container="${wrapper.containerMarkerValue}"]`) ||
        selector.includes(`[data-contract-container='${wrapper.containerMarkerValue}']`) ||
        selector.includes(`[data-contract-container=${wrapper.containerMarkerValue}]`));
    if (
      contractContainerClassSelector ||
      genericContainerAttribute ||
      specificContainerAttribute
    ) {
      return true;
    }
  }

  return false;
}

function parseChromeCssSignals(
  rule: ChromeCssRule,
): {
  radiusSignals: Array<ChromeSignal<number>>;
  shadowSignals: Array<ChromeSignal<ChromeShadowKind>>;
  ambiguousRadius: boolean;
  ambiguousShadow: boolean;
} {
  const radiusSignals: Array<ChromeSignal<number>> = [];
  const shadowSignals: Array<ChromeSignal<ChromeShadowKind>> = [];
  let ambiguousRadius = false;
  let ambiguousShadow = false;

  const radiusMatch = rule.declarationText.match(/\bborder-radius\s*:\s*([^;]+)/i);
  if (radiusMatch?.[1]) {
    const value = parseChromePxValue(radiusMatch[1]);
    if (value === undefined) {
      ambiguousRadius = true;
    } else {
      radiusSignals.push({ type: "radius", source: rule.source, value });
    }
  }

  const shadowMatch = rule.declarationText.match(/\bbox-shadow\s*:\s*([^;]+)/i);
  if (shadowMatch?.[1]) {
    const value = classifyDeterministicShadow(shadowMatch[1]);
    if (value === undefined) {
      ambiguousShadow = true;
    } else {
      shadowSignals.push({ type: "shadow", source: rule.source, value });
    }
  }

  return { radiusSignals, shadowSignals, ambiguousRadius, ambiguousShadow };
}

function parseChromePxValue(rawValue: string): number | undefined {
  const normalized = String(rawValue ?? "")
    .trim()
    .replace(/['"`]/g, "");
  if (!normalized) {
    return undefined;
  }
  if (normalized === "0") {
    return 0;
  }
  const pxMatch = normalized.match(/^(-?\d+(?:\.\d+)?)px$/i);
  if (pxMatch) {
    return Number.parseFloat(pxMatch[1]);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return Number.parseFloat(normalized);
  }
  return undefined;
}

function classifyDeterministicShadow(
  rawValue: string,
): ChromeShadowKind | undefined {
  const raw = String(rawValue ?? "").trim();
  if (!raw) {
    return undefined;
  }
  if (/^[A-Za-z_$][\w$]*$/.test(raw)) {
    return undefined;
  }

  const normalized = raw.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized.includes("var(") ||
    normalized.includes("${") ||
    normalized === "inherit" ||
    normalized === "initial" ||
    normalized === "unset" ||
    normalized === "revert" ||
    normalized === "revert-layer"
  ) {
    return undefined;
  }
  if (normalized === "none" || normalized === "0" || normalized === "0px") {
    return "none";
  }

  const parts = normalized
    .split(/,(?![^()]*\))/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }

  const hasInset = parts.some((part) => /\binset\b/.test(part));
  const hasOuter = parts.some((part) => !/\binset\b/.test(part));

  if (hasInset && hasOuter) {
    return "mixed";
  }
  if (hasInset) {
    return "inset";
  }
  return "outer";
}

async function extractLandingPattern(
  sectionFiles: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
): Promise<LandingPatternDescriptor | undefined> {
  const landingPagePath = await selectLandingPageFile(
    sectionFiles,
    fileContentCache,
  );
  if (!landingPagePath) {
    return undefined;
  }

  const content = await readFileCached(landingPagePath, fileContentCache);
  const sectionOrder: string[] = [];
  const topLevelSections: string[] = [];
  const nestedSections: string[] = [];
  const sectionStack: Array<{ tagName: string; id: string }> = [];
  const tagRegex = /<\/?([A-Za-z][\w.-]*)\b[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[0];
    const tagName = match[1];
    const isClosing = tag.startsWith("</");
    const isSelfClosing = /\/>\s*$/.test(tag);

    if (isClosing) {
      for (let index = sectionStack.length - 1; index >= 0; index -= 1) {
        if (sectionStack[index]?.tagName === tagName) {
          sectionStack.splice(index, 1);
          break;
        }
      }
      continue;
    }

    const sectionId = extractAttributeValue(tag, SECTION_ATTRIBUTE_REGEX);
    if (!sectionId) {
      continue;
    }

    sectionOrder.push(sectionId);
    if (sectionStack.length === 0) {
      topLevelSections.push(sectionId);
    } else if (!nestedSections.includes(sectionId)) {
      nestedSections.push(sectionId);
    }

    if (!isSelfClosing) {
      sectionStack.push({ tagName, id: sectionId });
    }
  }

  const marketingLayoutProfile = extractAttributeValue(
    content,
    MARKETING_LAYOUT_PROFILE_ATTRIBUTE_REGEX,
  );
  const heroContainerMode = extractAttributeValue(
    content,
    HERO_CONTAINER_MODE_ATTRIBUTE_REGEX,
  ) as LandingPatternDescriptor["heroContainerMode"];
  const heroVisualPlacement = extractAttributeValue(
    content,
    HERO_VISUAL_PLACEMENT_ATTRIBUTE_REGEX,
  ) as LandingPatternDescriptor["heroVisualPlacement"];
  const sectionDividerMode = extractAttributeValue(
    content,
    SECTION_DIVIDER_MODE_ATTRIBUTE_REGEX,
  ) as LandingPatternDescriptor["sectionDividerMode"];
  const sectionSpacingProfile = extractAttributeValue(
    content,
    SECTION_SPACING_PROFILE_ATTRIBUTE_REGEX,
  ) as LandingPatternDescriptor["sectionSpacingProfile"];

  return {
    sectionOrder,
    topLevelSections,
    nestedSections,
    pageBackgroundMode: extractPageBackgroundMode(content),
    marketingLayoutProfile,
    heroContainerMode,
    heroVisualPlacement,
    sectionDividerMode,
    sectionSpacingProfile,
    source: path.relative(workspaceRoot, landingPagePath),
  };
}

async function selectLandingPageFile(
  filePaths: string[],
  fileContentCache: Map<string, string>,
): Promise<string | undefined> {
  const scoredCandidates: Array<{ filePath: string; score: number }> = [];

  for (const filePath of filePaths) {
    const content = await readFileCached(filePath, fileContentCache);
    const sectionMatches = [...content.matchAll(SECTION_ATTRIBUTE_REGEX)].length;
    const copyRoleMatches = [...content.matchAll(COPY_ROLE_ATTRIBUTE_REGEX)].length;
    const marketingLayoutSignals =
      [...content.matchAll(MARKETING_LAYOUT_PROFILE_ATTRIBUTE_REGEX)].length +
      [...content.matchAll(HERO_CONTAINER_MODE_ATTRIBUTE_REGEX)].length +
      [...content.matchAll(HERO_VISUAL_PLACEMENT_ATTRIBUTE_REGEX)].length +
      [...content.matchAll(SECTION_DIVIDER_MODE_ATTRIBUTE_REGEX)].length +
      [...content.matchAll(SECTION_SPACING_PROFILE_ATTRIBUTE_REGEX)].length;
    const typographySignals =
      [...content.matchAll(TYPOGRAPHY_PROFILE_ATTRIBUTE_REGEX)].length;

    scoredCandidates.push({
      filePath,
      score:
        sectionMatches * 10 +
        marketingLayoutSignals * 4 +
        typographySignals * 4 +
        copyRoleMatches,
    });
  }

  const bestCandidate = [...scoredCandidates].sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    const leftRank = getLandingPageRank(left.filePath);
    const rightRank = getLandingPageRank(right.filePath);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.filePath.localeCompare(right.filePath);
  })[0];

  if (bestCandidate && bestCandidate.score > 0) {
    return bestCandidate.filePath;
  }

  const candidates = filePaths.filter((filePath) => filePath.endsWith(`${path.sep}page.tsx`));
  if (candidates.length === 0) {
    return undefined;
  }

  const ranked = [...candidates].sort((left, right) => {
    const leftRank = getLandingPageRank(left);
    const rightRank = getLandingPageRank(right);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.localeCompare(right);
  });

  return ranked[0];
}

function getLandingPageRank(filePath: string): number {
  if (filePath.includes(`${path.sep}app${path.sep}page.tsx`)) return 0;
  if (filePath.includes(`${path.sep}app${path.sep}(overview)${path.sep}page.tsx`)) return 1;
  if (filePath.includes(`${path.sep}app${path.sep}(marketing)${path.sep}page.tsx`)) return 2;
  return 10;
}

function extractAttributeValue(tag: string, regex: RegExp): string | undefined {
  regex.lastIndex = 0;
  const match = regex.exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4] ?? "";
  return value || undefined;
}

function extractPageBackgroundMode(content: string): "solid" | "custom" | "unknown" {
  const tagRegex = /<[A-Za-z][\w.-]*\b[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[0];
    if (!MIN_SCREEN_CLASS_REGEX.test(tag)) {
      continue;
    }
    if (/\bbackground\s*:/.test(tag)) {
      return "custom";
    }
    if (/\bbackgroundColor\s*:/.test(tag)) {
      return "solid";
    }
  }

  return "unknown";
}

async function extractPageFrameLayout(
  cssFilePaths: string[],
  sectionFiles: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
  pageFrameContract: InterfaceContract["surfaces"][number]["layout"]["pageFrame"],
): Promise<PageFrameLayoutDescriptor | undefined> {
  if (!pageFrameContract) {
    return undefined;
  }

  const containerSelector = pageFrameContract.containerSelector;
  
  // Check if selector is supported (v1 only supports data-contract="page-container")
  const isSupportedSelector =
    containerSelector === '[data-contract="page-container"]' ||
    containerSelector === "[data-contract='page-container']" ||
    containerSelector === '[data-contract={page-container}]';

  if (!isSupportedSelector) {
    // Return undefined to trigger selectorUnsupported violation
    return undefined;
  }

  // Check if page-container marker exists in source files
  let containerFound = false;
  let containerSource: string | undefined;
  let containerFileContent: string | undefined;
  for (const filePath of sectionFiles) {
    const content = await readFileCached(filePath, fileContentCache);
    // Reset regex state
    PAGE_CONTAINER_ATTRIBUTE_REGEX.lastIndex = 0;
    if (PAGE_CONTAINER_ATTRIBUTE_REGEX.test(content)) {
      containerFound = true;
      containerSource = path.relative(workspaceRoot, filePath);
      containerFileContent = content;
      break;
    }
  }

  if (!containerFound) {
    // Container marker not found - return partial descriptor
    return {
      containerSelector,
      maxWidthPx: null,
      minWidthPx: null,
      paddingLeftPx: null,
      paddingRightPx: null,
      source: undefined,
      maxWidthHasClampCalc: undefined,
      minWidthHasClampCalc: undefined,
      paddingHasClampCalc: undefined,
    };
  }

  let maxWidthPx: number | null = null;
  let minWidthPx: number | null = null;
  let paddingLeftPx: number | null = null;
  let paddingRightPx: number | null = null;
  let extractionSource: string | undefined;
  let maxWidthHasClampCalc = false;
  let minWidthHasClampCalc = false;
  let paddingHasClampCalc = false;

  // Strategy A: Extract from inline styles on the marked element
  if (containerFileContent) {
    INLINE_STYLE_REGEX.lastIndex = 0;
    let styleMatch: RegExpExecArray | null;
    while ((styleMatch = INLINE_STYLE_REGEX.exec(containerFileContent)) !== null) {
      const styleContent =
        styleMatch[1] ?? styleMatch[2] ?? styleMatch[3] ?? styleMatch[4] ?? "";

      // Extract max-width
      if (maxWidthPx === null) {
        INLINE_MAX_WIDTH_REGEX.lastIndex = 0;
        const maxWidthMatch = INLINE_MAX_WIDTH_REGEX.exec(styleContent);
        if (maxWidthMatch) {
          const maxWidthValue = maxWidthMatch[0];
          // Check if this specific max-width value uses clamp/calc
          if (CLAMP_REGEX.test(maxWidthValue) || CALC_REGEX.test(maxWidthValue)) {
            maxWidthHasClampCalc = true;
          } else {
            const value = Number.parseFloat(maxWidthMatch[1]);
            if (Number.isFinite(value)) {
              maxWidthPx = value;
              extractionSource = containerSource;
            }
          }
        }
      }

      // Extract min-width
      if (minWidthPx === null) {
        const minWidthDeclMatch = /min-width\s*:\s*([^;]+)/i.exec(styleContent);
        if (minWidthDeclMatch) {
          const minWidthValue = minWidthDeclMatch[1].trim();
          if (CLAMP_REGEX.test(minWidthValue) || CALC_REGEX.test(minWidthValue)) {
            minWidthHasClampCalc = true;
          } else {
            INLINE_MIN_WIDTH_REGEX.lastIndex = 0;
            const minWidthMatch = INLINE_MIN_WIDTH_REGEX.exec(styleContent);
            if (minWidthMatch) {
              const value = Number.parseFloat(minWidthMatch[1]);
              if (Number.isFinite(value)) {
                minWidthPx = value;
                extractionSource = containerSource;
              }
            }
          }
        }
      }

      // Extract padding
      if (paddingLeftPx === null || paddingRightPx === null) {
        INLINE_PADDING_INLINE_REGEX.lastIndex = 0;
        const paddingInlineMatch = INLINE_PADDING_INLINE_REGEX.exec(styleContent);
        if (paddingInlineMatch) {
          const paddingValue = paddingInlineMatch[0];
          // Check if this specific padding value uses clamp/calc
          if (CLAMP_REGEX.test(paddingValue) || CALC_REGEX.test(paddingValue)) {
            paddingHasClampCalc = true;
          } else {
            const value = Number.parseFloat(paddingInlineMatch[1]);
            if (Number.isFinite(value)) {
              paddingLeftPx = value;
              paddingRightPx = value;
              extractionSource = containerSource;
            }
          }
        } else {
          INLINE_PADDING_LEFT_REGEX.lastIndex = 0;
          INLINE_PADDING_RIGHT_REGEX.lastIndex = 0;
          const leftMatch = INLINE_PADDING_LEFT_REGEX.exec(styleContent);
          const rightMatch = INLINE_PADDING_RIGHT_REGEX.exec(styleContent);
          if (leftMatch && rightMatch) {
            const leftValueStr = leftMatch[0];
            const rightValueStr = rightMatch[0];
            // Check if padding values use clamp/calc
            if (
              CLAMP_REGEX.test(leftValueStr) ||
              CALC_REGEX.test(leftValueStr) ||
              CLAMP_REGEX.test(rightValueStr) ||
              CALC_REGEX.test(rightValueStr)
            ) {
              paddingHasClampCalc = true;
            } else {
              const leftValue = Number.parseFloat(leftMatch[1]);
              const rightValue = Number.parseFloat(rightMatch[1]);
              if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
                paddingLeftPx = leftValue;
                paddingRightPx = rightValue;
                extractionSource = containerSource;
              }
            }
          }
        }
      }
    }
  }

  // Strategy B: Extract from CSS rules targeting [data-contract="page-container"]
  if (
    maxWidthPx === null ||
    minWidthPx === null ||
    paddingLeftPx === null ||
    paddingRightPx === null
  ) {
    for (const cssPath of cssFilePaths) {
      const cssContent = await readFileCached(cssPath, fileContentCache);

      CSS_SELECTOR_PAGE_CONTAINER_REGEX.lastIndex = 0;
      let selectorMatch: RegExpExecArray | null;
      while ((selectorMatch = CSS_SELECTOR_PAGE_CONTAINER_REGEX.exec(cssContent)) !== null) {
        const ruleContent = selectorMatch[1];

        // Extract max-width (check for clamp/calc in max-width declaration)
        if (maxWidthPx === null) {
          // First check if max-width exists (even with clamp/calc)
          const maxWidthDeclMatch = /max-width\s*:\s*([^;]+)/i.exec(ruleContent);
          if (maxWidthDeclMatch) {
            const maxWidthValue = maxWidthDeclMatch[1].trim();
            // Check if this specific max-width value uses clamp/calc
            if (CLAMP_REGEX.test(maxWidthValue) || CALC_REGEX.test(maxWidthValue)) {
              maxWidthHasClampCalc = true;
            } else {
              // Try to extract px value
              CSS_MAX_WIDTH_REGEX.lastIndex = 0;
              const maxWidthMatch = CSS_MAX_WIDTH_REGEX.exec(ruleContent);
              if (maxWidthMatch) {
                const value = Number.parseFloat(maxWidthMatch[1]);
                if (Number.isFinite(value)) {
                  maxWidthPx = value;
                  extractionSource = path.relative(workspaceRoot, cssPath);
                }
              }
            }
          }
        }

        // Extract min-width (check for clamp/calc in min-width declaration)
        if (minWidthPx === null) {
          const minWidthDeclMatch = /min-width\s*:\s*([^;]+)/i.exec(ruleContent);
          if (minWidthDeclMatch) {
            const minWidthValue = minWidthDeclMatch[1].trim();
            if (CLAMP_REGEX.test(minWidthValue) || CALC_REGEX.test(minWidthValue)) {
              minWidthHasClampCalc = true;
            } else {
              CSS_MIN_WIDTH_REGEX.lastIndex = 0;
              const minWidthMatch = CSS_MIN_WIDTH_REGEX.exec(ruleContent);
              if (minWidthMatch) {
                const value = Number.parseFloat(minWidthMatch[1]);
                if (Number.isFinite(value)) {
                  minWidthPx = value;
                  extractionSource = path.relative(workspaceRoot, cssPath);
                }
              }
            }
          }
        }

        // Extract padding (check for clamp/calc in padding declarations)
        if (paddingLeftPx === null || paddingRightPx === null) {
          // First check if padding-inline exists (even with clamp/calc)
          const paddingInlineDeclMatch = /padding-inline\s*:\s*([^;]+)/i.exec(ruleContent);
          if (paddingInlineDeclMatch) {
            const paddingValue = paddingInlineDeclMatch[1].trim();
            // Check if this specific padding value uses clamp/calc
            if (CLAMP_REGEX.test(paddingValue) || CALC_REGEX.test(paddingValue)) {
              paddingHasClampCalc = true;
            } else {
              // Try to extract px value
              CSS_PADDING_INLINE_REGEX.lastIndex = 0;
              const paddingInlineMatch = CSS_PADDING_INLINE_REGEX.exec(ruleContent);
              if (paddingInlineMatch) {
                const value = Number.parseFloat(paddingInlineMatch[1]);
                if (Number.isFinite(value)) {
                  paddingLeftPx = value;
                  paddingRightPx = value;
                  extractionSource = path.relative(workspaceRoot, cssPath);
                }
              }
            }
          } else {
            CSS_PADDING_LEFT_REGEX.lastIndex = 0;
            CSS_PADDING_RIGHT_REGEX.lastIndex = 0;
            const leftMatch = CSS_PADDING_LEFT_REGEX.exec(ruleContent);
            const rightMatch = CSS_PADDING_RIGHT_REGEX.exec(ruleContent);
            if (leftMatch && rightMatch) {
              const leftValueStr = leftMatch[0];
              const rightValueStr = rightMatch[0];
              // Check if padding values use clamp/calc
              if (
                CLAMP_REGEX.test(leftValueStr) ||
                CALC_REGEX.test(leftValueStr) ||
                CLAMP_REGEX.test(rightValueStr) ||
                CALC_REGEX.test(rightValueStr)
              ) {
                paddingHasClampCalc = true;
              } else {
                const leftValue = Number.parseFloat(leftMatch[1]);
                const rightValue = Number.parseFloat(rightMatch[1]);
                if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
                  paddingLeftPx = leftValue;
                  paddingRightPx = rightValue;
                  extractionSource = path.relative(workspaceRoot, cssPath);
                }
              }
            }
          }
        }
      }
    }
  }

  // Strategy C: Extract from Tailwind bracket classes (best-effort, v1)
  if (
    maxWidthPx === null ||
    minWidthPx === null ||
    paddingLeftPx === null ||
    paddingRightPx === null
  ) {
    for (const filePath of sectionFiles) {
      const content = await readFileCached(filePath, fileContentCache);
      
      // Extract max-width from max-w-[NNNpx]
      if (maxWidthPx === null) {
        TAILWIND_MAX_WIDTH_REGEX.lastIndex = 0;
        const maxWidthMatch = TAILWIND_MAX_WIDTH_REGEX.exec(content);
        if (maxWidthMatch) {
          const value = Number.parseFloat(maxWidthMatch[1]);
          if (Number.isFinite(value)) {
            maxWidthPx = value;
            extractionSource = path.relative(workspaceRoot, filePath);
          }
        }
      }

      // Extract min-width from min-w-[NNNpx]
      if (minWidthPx === null) {
        TAILWIND_MIN_WIDTH_REGEX.lastIndex = 0;
        const minWidthMatch = TAILWIND_MIN_WIDTH_REGEX.exec(content);
        if (minWidthMatch) {
          const value = Number.parseFloat(minWidthMatch[1]);
          if (Number.isFinite(value)) {
            minWidthPx = value;
            extractionSource = path.relative(workspaceRoot, filePath);
          }
        }
      }

      // Extract padding from px-[NNpx] or pl-[NNpx]/pr-[NNpx]
      if (paddingLeftPx === null || paddingRightPx === null) {
        TAILWIND_PADDING_X_REGEX.lastIndex = 0;
        const paddingXMatch = TAILWIND_PADDING_X_REGEX.exec(content);
        if (paddingXMatch) {
          const value = Number.parseFloat(paddingXMatch[1]);
          if (Number.isFinite(value)) {
            paddingLeftPx = value;
            paddingRightPx = value;
            extractionSource = path.relative(workspaceRoot, filePath);
          }
        } else {
          TAILWIND_PADDING_LEFT_REGEX.lastIndex = 0;
          TAILWIND_PADDING_RIGHT_REGEX.lastIndex = 0;
          const leftMatch = TAILWIND_PADDING_LEFT_REGEX.exec(content);
          const rightMatch = TAILWIND_PADDING_RIGHT_REGEX.exec(content);
          if (leftMatch && rightMatch) {
            const leftValue = Number.parseFloat(leftMatch[1]);
            const rightValue = Number.parseFloat(rightMatch[1]);
            if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
              paddingLeftPx = leftValue;
              paddingRightPx = rightValue;
              extractionSource = path.relative(workspaceRoot, filePath);
            }
          }
        }
      }
    }
  }

  // Optional: CSS custom properties (fallback, not required)
  if (
    maxWidthPx === null ||
    minWidthPx === null ||
    paddingLeftPx === null ||
    paddingRightPx === null
  ) {
    for (const cssPath of cssFilePaths) {
      const cssContent = await readFileCached(cssPath, fileContentCache);
      
      if (maxWidthPx === null) {
        const varMatch = cssContent.match(PAGE_FRAME_MAX_WIDTH_VAR_REGEX);
        if (varMatch) {
          const value = Number.parseFloat(varMatch[1]);
          if (Number.isFinite(value)) {
            maxWidthPx = value;
            extractionSource = path.relative(workspaceRoot, cssPath);
          }
        }
      }

      if (minWidthPx === null) {
        const minWidthMatch = cssContent.match(PAGE_FRAME_MIN_WIDTH_VAR_REGEX);
        if (minWidthMatch) {
          const value = Number.parseFloat(minWidthMatch[1]);
          if (Number.isFinite(value)) {
            minWidthPx = value;
            extractionSource = path.relative(workspaceRoot, cssPath);
          }
        }
      }

      if (paddingLeftPx === null || paddingRightPx === null) {
        const paddingXMatch = cssContent.match(PAGE_FRAME_PADDING_VAR_REGEX);
        if (paddingXMatch) {
          const value = Number.parseFloat(paddingXMatch[1]);
          if (Number.isFinite(value)) {
            paddingLeftPx = value;
            paddingRightPx = value;
            extractionSource = path.relative(workspaceRoot, cssPath);
          }
        }
      }
    }
  }

  return {
    containerSelector,
    maxWidthPx,
    minWidthPx,
    paddingLeftPx,
    paddingRightPx,
    source: extractionSource ?? containerSource,
    maxWidthHasClampCalc: maxWidthHasClampCalc || undefined,
    minWidthHasClampCalc: minWidthHasClampCalc || undefined,
    paddingHasClampCalc: paddingHasClampCalc || undefined,
  };
}

async function extractMotion(
  cssFilePaths: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
): Promise<SurfaceMotionDescriptor[]> {
  const motions = new Map<string, SurfaceMotionDescriptor>();
  const durationVariables = new Map<string, number>();
  let defaultTiming: string | undefined;

  for (const cssPath of cssFilePaths) {
    const cssContent = await readFileCached(cssPath, fileContentCache);

    const durationVarMatch = cssContent.match(MOTION_DURATION_VAR_REGEX);
    if (durationVarMatch) {
      const [, value, unit] = durationVarMatch;
      const durationMs = parseDurationToMs(value, unit);
      if (durationMs !== null) {
        durationVariables.set("--contract-motion-duration", durationMs);
      }
    }

    const timingVarMatch = cssContent.match(MOTION_TIMING_VAR_REGEX);
    if (timingVarMatch) {
      defaultTiming = timingVarMatch[1];
    }
  }

  for (const cssPath of cssFilePaths) {
    const cssContent = await readFileCached(cssPath, fileContentCache);
    const relative = path.relative(workspaceRoot, cssPath);

    let match: RegExpExecArray | null;
    while ((match = DURATION_DECL_REGEX.exec(cssContent)) !== null) {
      const [, , value] = match;
      const durations = parseDurationExpressions(value, durationVariables);
      for (const duration of durations) {
        const key = toMotionKey(duration, defaultTiming ?? "linear");
        if (!motions.has(key)) {
          motions.set(key, {
            durationMs: duration,
            timingFunction: defaultTiming ?? "linear",
            source: relative,
          });
        }
      }
    }

    while ((match = TRANSITION_DECL_REGEX.exec(cssContent)) !== null) {
      const [, value] = match;
      const durations = parseDurationExpressions(value, durationVariables);
      const timingFunctions = parseTimingFunctions(value, defaultTiming);

      for (const duration of durations) {
        for (const timing of timingFunctions) {
          const key = toMotionKey(duration, timing);
          if (!motions.has(key)) {
            motions.set(key, {
              durationMs: duration,
              timingFunction: timing,
              source: relative,
            });
          }
        }
      }
    }

    while ((match = TIMING_DECL_REGEX.exec(cssContent)) !== null) {
      const [, , value] = match;
      const timingFunctions = parseTimingFunctions(value, defaultTiming);
      for (const timing of timingFunctions) {
        const key = toMotionKey(
          durationVariables.get("--contract-motion-duration") ?? 0,
          timing,
        );
        if (!motions.has(key)) {
          motions.set(key, {
            durationMs:
              durationVariables.get("--contract-motion-duration") ?? 0,
            timingFunction: timing,
            source: relative,
          });
        }
      }
    }
  }

  return [...motions.values()].filter((motion) => motion.durationMs > 0);
}

function collectFontsFromContent(
  content: string,
  source: string,
  fontValues: Map<string, SurfaceFontDescriptor>,
) {
  let match: RegExpExecArray | null;
  while ((match = FONT_VAR_REGEX.exec(content)) !== null) {
    const variable = `var(${match[1]})`;
    if (!fontValues.has(variable)) {
      fontValues.set(variable, { value: variable, source });
    }
  }

  while ((match = FONT_FAMILY_REGEX.exec(content)) !== null) {
    const families = match[1]
      .split(",")
      .map((token) => token.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);

    for (const family of families) {
      if (!fontValues.has(family)) {
        fontValues.set(family, { value: family, source });
      }
    }
  }
}

function collectColorsFromContent(
  content: string,
  source: string,
  colorValues: Map<string, SurfaceColorDescriptor>,
) {
  let match: RegExpExecArray | null;
  
  // Extract CSS color variables
  while ((match = COLOR_VAR_REGEX.exec(content)) !== null) {
    const variable = `var(${match[1]})`;
    if (!colorValues.has(variable)) {
      colorValues.set(variable, { value: variable, source });
    }
  }

  // Extract direct color declarations
  while ((match = COLOR_DECL_REGEX.exec(content)) !== null) {
    // Skip CSS variable definitions (--variable-name: value;)
    // Check if the match is part of a CSS variable definition by looking for -- before it
    const matchIndex = match.index;
    let isCssVariable = false;
    // Look backwards from the match to find if it's part of a --variable definition
    for (let i = matchIndex - 1; i >= 0 && i >= matchIndex - 50; i--) {
      if (content[i] === '\n' || content[i] === ';') {
        break; // Found start of line or previous declaration
      }
      if (content[i] === '-' && i > 0 && content[i - 1] === '-') {
        isCssVariable = true; // Found -- before the match
        break;
      }
    }
    if (isCssVariable) {
      continue;
    }
    
    const colorValue = match[1].trim();
    if (!colorValue) {
      continue;
    }

    // Parse color value - handle multiple values (e.g., in gradients)
    const colors = parseColorValue(colorValue);
    for (const color of colors) {
      if (color && !colorValues.has(color)) {
        colorValues.set(color, { value: color, source });
      }
    }
  }
}

async function extractPrimitives(
  sectionFiles: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
): Promise<SurfacePrimitiveDescriptor[]> {
  const counts = new Map<string, { count: number; sources: Set<string> }>();

  for (const filePath of sectionFiles) {
    const content = await readFileCached(filePath, fileContentCache);
    for (const { role, regex } of PRIMITIVE_PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const entry = counts.get(role) ?? { count: 0, sources: new Set<string>() };
        entry.count += 1;
        entry.sources.add(path.relative(workspaceRoot, filePath));
        counts.set(role, entry);
      }
    }
  }

  return [...counts.entries()]
    .map(([role, { count, sources }]) => ({
      role,
      count,
      sources: [...sources],
    }))
    .sort((a, b) => a.role.localeCompare(b.role));
}

async function extractTokenUsage(
  cssFilePaths: string[],
  sectionFiles: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
): Promise<{
  tokenUsage: SurfaceTokenUsage;
  warnings: DescriptorIssue[];
}> {
  const typography = new Map<string, RawObservedToken>();
  const layout = new Map<string, RawObservedToken>();
  const motion = new Map<string, RawObservedToken>();
  const tokenDefinitions = new Map<string, TokenDefinition>();

  for (const filePath of [...cssFilePaths, ...sectionFiles]) {
    const content = await readFileCached(filePath, fileContentCache);
    const source = path.relative(workspaceRoot, filePath);
    const isCssSource = /\.css$/i.test(filePath);
    collectTokenDefinitionsFromContent(content, source, tokenDefinitions);
    collectTokenDescriptorsFromContent(
      content,
      source,
      TYPOGRAPHY_TOKEN_DECL_REGEX,
      typography,
    );
    collectTokenDescriptorsFromContent(
      content,
      source,
      LAYOUT_TOKEN_DECL_REGEX,
      layout,
    );
    collectTokenDescriptorsFromContent(
      content,
      source,
      MOTION_TOKEN_DECL_REGEX,
      motion,
    );
    if (!isCssSource) {
      collectTokenDescriptorsFromMatches(
        content,
        source,
        JSX_TYPOGRAPHY_TOKEN_DECL_REGEX,
        typography,
      );
      collectTokenDescriptorsFromMatches(
        content,
        source,
        JSX_LAYOUT_TOKEN_DECL_REGEX,
        layout,
      );
      collectTokenDescriptorsFromMatches(
        content,
        source,
        JSX_MOTION_TOKEN_DECL_REGEX,
        motion,
      );
    }
  }

  const typographyNormalized = normalizeObservedTokens(
    "typography",
    typography,
    tokenDefinitions,
  );
  const layoutNormalized = normalizeObservedTokens("layout", layout, tokenDefinitions);
  const motionNormalized = normalizeObservedTokens("motion", motion, tokenDefinitions);

  return {
    tokenUsage: {
      typography: typographyNormalized.tokens,
      layout: layoutNormalized.tokens,
      motion: motionNormalized.tokens,
    },
    warnings: [
      ...typographyNormalized.warnings,
      ...layoutNormalized.warnings,
      ...motionNormalized.warnings,
    ].map((warning) => ({
      code: warning.code,
      message: warning.message,
      location: warning.location,
    })),
  };
}

function collectTokenDescriptorsFromContent(
  content: string,
  source: string,
  declarationRegex: RegExp,
  tokenValues: Map<string, RawObservedToken>,
): void {
  collectTokenDescriptorsFromMatches(content, source, declarationRegex, tokenValues);
}

async function extractMarketingTypography(
  cssFilePaths: string[],
  sectionFiles: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
): Promise<{
  typography?: SurfaceMarketingTypographyDescriptor;
  warnings: DescriptorIssue[];
}> {
  const landingPagePath = await selectLandingPageFile(
    sectionFiles,
    fileContentCache,
  );
  if (!landingPagePath) {
    return { typography: undefined, warnings: [] };
  }

  const tokenDefinitions = new Map<string, TokenDefinition>();
  for (const filePath of [...cssFilePaths, ...sectionFiles]) {
    const content = await readFileCached(filePath, fileContentCache);
    collectTokenDefinitionsFromContent(
      content,
      path.relative(workspaceRoot, filePath),
      tokenDefinitions,
    );
  }

  const content = await readFileCached(landingPagePath, fileContentCache);
  const source = path.relative(workspaceRoot, landingPagePath);
  const profileId = extractAttributeValue(content, TYPOGRAPHY_PROFILE_ATTRIBUTE_REGEX);
  const roleMaps = new Map<
    MarketingTypographyRole,
    {
      tokens: Map<string, RawObservedToken>;
      source: string;
    }
  >();
  const warnings: DescriptorIssue[] = [];

  TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_REGEX.exec(content)) !== null) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      continue;
    }

    const role = extractAttributeValue(
      tag,
      COPY_ROLE_ATTRIBUTE_REGEX,
    ) as MarketingTypographyRole | undefined;
    if (!role) {
      continue;
    }

    if (!roleMaps.has(role)) {
      roleMaps.set(role, {
        tokens: new Map<string, RawObservedToken>(),
        source,
      });
    }

    const entry = roleMaps.get(role);
    if (!entry) {
      continue;
    }

    collectTokenDescriptorsFromContent(
      tag,
      source,
      TYPOGRAPHY_TOKEN_DECL_REGEX,
      entry.tokens,
    );
    collectTokenDescriptorsFromMatches(
      tag,
      source,
      JSX_TYPOGRAPHY_TOKEN_DECL_REGEX,
      entry.tokens,
    );
  }

  const roles: SurfaceMarketingTypographyRoleDescriptor[] = [];
  for (const [role, entry] of roleMaps.entries()) {
    const normalized = normalizeObservedTokens(
      "typography",
      entry.tokens,
      tokenDefinitions,
    );
    roles.push({
      role,
      tokens: normalized.tokens,
      source: entry.source,
    });
    warnings.push(
      ...normalized.warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
        location: warning.location,
      })),
    );
  }

  if (!profileId && roles.length === 0) {
    return { typography: undefined, warnings };
  }

  return {
    typography: {
      profileId,
      roles: roles.sort((left, right) => left.role.localeCompare(right.role)),
      source,
    },
    warnings,
  };
}

function collectTokenDescriptorsFromMatches(
  content: string,
  source: string,
  declarationRegex: RegExp,
  tokenValues: Map<string, RawObservedToken>,
): void {
  declarationRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = declarationRegex.exec(content)) !== null) {
    const attribute = normalizeTokenAttribute(match[1] ?? "");
    const value = match[2] ?? "";
    GENERIC_VAR_REGEX.lastIndex = 0;
    let variableMatch: RegExpExecArray | null;
    while ((variableMatch = GENERIC_VAR_REGEX.exec(value)) !== null) {
      const token = `var(${variableMatch[1]})`;
      if (!tokenValues.has(token)) {
        tokenValues.set(token, {
          observedValue: token,
          source,
          attributes: new Set(attribute ? [attribute] : []),
        });
        continue;
      }

      const existing = tokenValues.get(token);
      if (existing && attribute) {
        existing.attributes.add(attribute);
      }
    }
  }
}

function normalizeTokenAttribute(attribute: string): string {
  return attribute
    .trim()
    .replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
    .toLowerCase();
}

async function extractIconSources(
  surfaceRoot: string,
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
  surfaceId: string,
): Promise<{
  icons: SurfaceIconDescriptor[];
  warnings: DescriptorIssue[];
}> {
  const warnings: DescriptorIssue[] = [];
  const iconSources = new Map<string, SurfaceIconDescriptor>();
  const unresolvedSharedImports = new Set<string>();
  const sharedUiRoots = await findSharedUiSourceRoots(workspaceRoot);

  const sourceFiles = await globby(["**/*.{ts,tsx,js,jsx,mts,mjs,cjs,cts}"], {
    cwd: surfaceRoot,
    absolute: true,
    gitignore: true,
    ignore: COMMON_GLOBBY_IGNORES,
  });

  const sharedQueue: string[] = [];
  const queuedSharedFiles = new Set<string>();

  const enqueueSharedFile = (filePath: string) => {
    if (!queuedSharedFiles.has(filePath)) {
      queuedSharedFiles.add(filePath);
      sharedQueue.push(filePath);
    }
  };

  for (const filePath of sourceFiles) {
    const content = await readFileCached(filePath, fileContentCache);
    const fileSource = path.relative(workspaceRoot, filePath);
    const importSpecifiers = parseModuleSpecifiers(content);

    for (const specifier of importSpecifiers) {
      if (specifier.startsWith(SURFACES_UI_COMPONENT_PREFIX)) {
        const resolved = await resolveSharedUiComponentImport(
          specifier,
          sharedUiRoots,
        );
        if (resolved) {
          enqueueSharedFile(resolved);
        } else {
          unresolvedSharedImports.add(specifier);
        }
        continue;
      }

      if (
        isExternalModuleSpecifier(specifier) &&
        isIconLibrarySpecifier(specifier)
      ) {
        if (!iconSources.has(specifier)) {
          iconSources.set(specifier, {
            value: specifier,
            source: fileSource,
          });
        }
      }
    }
  }

  while (sharedQueue.length > 0) {
    const filePath = sharedQueue.shift();
    if (!filePath) {
      continue;
    }

    const content = await readFileCached(filePath, fileContentCache);
    const fileSource = path.relative(workspaceRoot, filePath);
    const importSpecifiers = parseModuleSpecifiers(content);

    for (const specifier of importSpecifiers) {
      if (
        isExternalModuleSpecifier(specifier) &&
        isIconLibrarySpecifier(specifier)
      ) {
        if (!iconSources.has(specifier)) {
          iconSources.set(specifier, {
            value: specifier,
            source: fileSource,
          });
        }
        continue;
      }

      if (specifier.startsWith(SURFACES_UI_COMPONENT_PREFIX)) {
        const resolved = await resolveSharedUiComponentImport(
          specifier,
          sharedUiRoots,
        );
        if (resolved) {
          enqueueSharedFile(resolved);
        } else {
          unresolvedSharedImports.add(specifier);
        }
        continue;
      }

      if (specifier.startsWith(".")) {
        const resolved = await resolveModulePath(path.dirname(filePath), specifier);
        if (resolved && isPathWithinRoots(resolved, sharedUiRoots)) {
          enqueueSharedFile(resolved);
        }
      }
    }
  }

  for (const specifier of [...unresolvedSharedImports].sort((a, b) =>
    a.localeCompare(b),
  )) {
    warnings.push({
      surfaceId,
      code: "icons.shared-ui-unresolved",
      message: `Shared UI import "${specifier}" could not be resolved; icon source detection may be incomplete for surface "${surfaceId}".`,
    });
  }

  return {
    icons: [...iconSources.values()].sort((a, b) =>
      a.value.localeCompare(b.value),
    ),
    warnings,
  };
}

function parseModuleSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();
  IMPORT_SOURCE_REGEX.lastIndex = 0;
  EXPORT_SOURCE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = IMPORT_SOURCE_REGEX.exec(content)) !== null) {
    if (match[1]) {
      specifiers.add(match[1]);
    }
  }
  while ((match = EXPORT_SOURCE_REGEX.exec(content)) !== null) {
    if (match[1]) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

function isExternalModuleSpecifier(specifier: string): boolean {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("~/")
  ) {
    return false;
  }
  return true;
}

function isIconLibrarySpecifier(specifier: string): boolean {
  if (ICON_LIBRARY_PATTERNS.some((pattern) => pattern.test(specifier))) {
    return true;
  }

  const normalized = specifier.toLowerCase();
  if (normalized.startsWith("@surfaces/ui")) {
    return false;
  }

  return /(^|\/)icons?(\/|$)/.test(normalized);
}

async function findSharedUiSourceRoots(workspaceRoot: string): Promise<string[]> {
  const candidates = [
    path.join(workspaceRoot, "packages", "ui", "src"),
    path.join(workspaceRoot, "..", "packages", "ui", "src"),
    path.join(workspaceRoot, "..", "surfaces-webapps", "packages", "ui", "src"),
    path.join(
      workspaceRoot,
      "..",
      "..",
      "surfaces-webapps",
      "packages",
      "ui",
      "src",
    ),
  ];

  const roots: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    if (await pathExists(resolved)) {
      roots.push(resolved);
    }
  }
  return roots;
}

async function resolveSharedUiComponentImport(
  specifier: string,
  sharedUiRoots: string[],
): Promise<string | undefined> {
  if (!specifier.startsWith(SURFACES_UI_COMPONENT_PREFIX)) {
    return undefined;
  }

  const componentPath = specifier.slice(SURFACES_UI_COMPONENT_PREFIX.length);
  for (const root of sharedUiRoots) {
    const resolved = await resolveModulePath(
      root,
      path.join("components", componentPath),
    );
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

async function resolveModulePath(
  baseDir: string,
  targetPath: string,
): Promise<string | undefined> {
  const absolutePath = path.resolve(baseDir, targetPath);
  return resolveWithExtensions(absolutePath);
}

async function resolveWithExtensions(
  absolutePath: string,
): Promise<string | undefined> {
  const directCandidates = [absolutePath];
  if (path.extname(absolutePath).length === 0) {
    for (const ext of MODULE_EXTENSIONS) {
      directCandidates.push(`${absolutePath}${ext}`);
    }
  }

  for (const candidate of directCandidates) {
    if (await pathIsFile(candidate)) {
      return candidate;
    }
  }

  for (const basename of INDEX_MODULE_BASENAMES) {
    const indexCandidate = path.join(absolutePath, basename);
    if (await pathIsFile(indexCandidate)) {
      return indexCandidate;
    }
  }

  return undefined;
}

function isPathWithinRoots(filePath: string, roots: string[]): boolean {
  return roots.some((root) => {
    const relative = path.relative(root, filePath);
    return Boolean(relative) && !relative.startsWith("..");
  });
}

function parseColorValue(value: string): string[] {
  const colors: string[] = [];
  const trimmed = value.trim();

  // Skip if it's a gradient or other complex value
  if (
    trimmed.includes("gradient") ||
    trimmed.includes("url(") ||
    trimmed.includes("calc(")
  ) {
    return colors;
  }

  // Handle comma-separated values, but preserve function calls like rgb(), rgba(), hsl()
  // Split by comma, but don't split inside function parentheses
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === "(") {
      depth++;
      current += char;
    } else if (char === ")") {
      depth--;
      current += char;
    } else if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  
  for (const part of parts) {
    // CSS variable - extract all var() calls from color declarations
    if (part.startsWith("var(")) {
      const varMatch = part.match(/var\(([^)]+)\)/);
      if (varMatch) {
        colors.push(`var(${varMatch[1]})`);
      }
      continue;
    }

    // Hex colors (#fff, #ffffff)
    const hexMatch = part.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      colors.push(part.toLowerCase());
      continue;
    }

    // rgb/rgba colors
    const rgbMatch = part.match(/^(rgba?)\s*\(\s*([^)]+)\s*\)$/i);
    if (rgbMatch) {
      colors.push(part.toLowerCase());
      continue;
    }

    // hsl/hsla colors
    const hslMatch = part.match(/^(hsla?)\s*\(\s*([^)]+)\s*\)$/i);
    if (hslMatch) {
      colors.push(part.toLowerCase());
      continue;
    }

    // Named colors (case-insensitive)
    const namedColorMatch = part.match(/^[a-z]+$/i);
    if (namedColorMatch) {
      // Common CSS named colors
      const namedColor = part.toLowerCase();
      const commonColors = [
        "transparent",
        "currentcolor",
        "inherit",
        "initial",
        "unset",
        "revert",
        "black",
        "white",
        "red",
        "green",
        "blue",
        "yellow",
        "orange",
        "purple",
        "pink",
        "brown",
        "gray",
        "grey",
        "cyan",
        "magenta",
        "lime",
        "navy",
        "olive",
        "teal",
        "aqua",
        "maroon",
        "silver",
        "gold",
      ];
      // Only accept known CSS named colors, not arbitrary words
      if (commonColors.includes(namedColor)) {
        colors.push(namedColor);
      }
    }
  }

  return colors;
}

function collectContainersFromContent(content: string): Set<string> {
  const containers = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = CONTAINER_ATTRIBUTE_REGEX.exec(content)) !== null) {
    const raw =
      match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
    if (!raw) {
      continue;
    }
    for (const token of raw.split(/\s+/).filter(Boolean)) {
      containers.add(token);
    }
  }

  if (content.includes(CONTRACT_CONTAINER_TOKEN)) {
    containers.add(CONTRACT_CONTAINER_TOKEN);
  }

  return containers;
}

async function readFileCached(
  filePath: string,
  cache: Map<string, string>,
): Promise<string> {
  const cached = cache.get(filePath);
  if (cached !== undefined) {
    return cached;
  }
  const contents = await readFile(filePath, "utf-8");
  cache.set(filePath, contents);
  return contents;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pathIsFile(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function parseDurationToMs(value: string, unit: string): number | null {
  const numericValue = Number.parseFloat(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  if (unit.toLowerCase() === "ms") {
    return numericValue;
  }

  if (unit.toLowerCase() === "s") {
    return numericValue * 1000;
  }

  return null;
}

function parseDurationExpressions(
  expression: string,
  durationVariables: Map<string, number>,
): number[] {
  const results: number[] = [];
  const tokens = expression.split(/[, ]+/).filter(Boolean);

  for (const token of tokens) {
    const variableMatch = token.match(/var\((--[a-z0-9-]+)\)/i);
    if (variableMatch) {
      const variableName = variableMatch[1];
      const value = durationVariables.get(variableName);
      if (value !== undefined) {
        results.push(value);
      }
      continue;
    }

    const directMatch = token.match(/^([0-9.]+)(ms|s)$/i);
    if (directMatch) {
      const [, value, unit] = directMatch;
      const duration = parseDurationToMs(value, unit);
      if (duration !== null) {
        results.push(duration);
      }
    }
  }

  return results;
}

function parseTimingFunctions(
  expression: string,
  fallback?: string,
): string[] {
  const results = new Set<string>();
  const tokens = expression.split(/[, ]+/).filter(Boolean);

  for (const token of tokens) {
    if (token.startsWith("var(")) {
      continue;
    }

    if (isTimingFunction(token)) {
      results.add(token);
    }
  }

  if (results.size === 0 && fallback) {
    results.add(fallback);
  }

  if (results.size === 0) {
    results.add("linear");
  }

  return [...results];
}

function isTimingFunction(token: string): boolean {
  return (
    [
      "linear",
      "ease",
      "ease-in",
      "ease-out",
      "ease-in-out",
      "step-start",
      "step-end",
    ].includes(token) || token.startsWith("cubic-bezier(")
  );
}

function toMotionKey(durationMs: number, timing: string): string {
  return `${durationMs}:${timing}`;
}
