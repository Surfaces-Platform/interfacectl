import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { globby } from "globby";
import {
  type InterfaceContract,
  type SurfaceDescriptor,
  type SurfaceFontDescriptor,
  type SurfaceColorDescriptor,
  type SurfaceLayoutDescriptor,
  type SurfaceMotionDescriptor,
  type SurfaceSectionDescriptor,
  type PageFrameLayoutDescriptor,
  type SurfacePrimitiveDescriptor,
} from "@surfaces/interfacectl-validator";

const SECTION_ATTRIBUTE_REGEX =
  /data-(?:contract-)?section\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;

const CONTAINER_ATTRIBUTE_REGEX =
  /data-contract-container\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;
const CONTRACT_CONTAINER_TOKEN = "contract-container";
const PAGE_CONTAINER_ATTRIBUTE_REGEX =
  /data-contract\s*=\s*(?:"page-container"|'page-container'|{`page-container`}|{\s*["'`]page-container["'`]\s*})/g;
// Inline style extraction
const INLINE_STYLE_REGEX = /style\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;
const INLINE_MAX_WIDTH_REGEX = /max-width\s*:\s*([0-9.]+)\s*px/gi;
const INLINE_PADDING_LEFT_REGEX = /padding-left\s*:\s*([0-9.]+)\s*px/gi;
const INLINE_PADDING_RIGHT_REGEX = /padding-right\s*:\s*([0-9.]+)\s*px/gi;
const INLINE_PADDING_INLINE_REGEX = /padding-inline\s*:\s*([0-9.]+)\s*px/gi;
// CSS rule extraction for [data-contract="page-container"]
const CSS_SELECTOR_PAGE_CONTAINER_REGEX = /\[data-contract\s*=\s*["']page-container["']\]\s*\{([^}]+)\}/gi;
const CSS_MAX_WIDTH_REGEX = /max-width\s*:\s*([0-9.]+)\s*px/gi;
const CSS_PADDING_LEFT_REGEX = /padding-left\s*:\s*([0-9.]+)\s*px/gi;
const CSS_PADDING_RIGHT_REGEX = /padding-right\s*:\s*([0-9.]+)\s*px/gi;
const CSS_PADDING_INLINE_REGEX = /padding-inline\s*:\s*([0-9.]+)\s*px/gi;
// Tailwind class extraction (best-effort)
const TAILWIND_MAX_WIDTH_REGEX = /max-w-\[([0-9.]+)px\]/gi;
const TAILWIND_PADDING_X_REGEX = /px-\[([0-9.]+)px\]/gi;
const TAILWIND_PADDING_LEFT_REGEX = /pl-\[([0-9.]+)px\]/gi;
const TAILWIND_PADDING_RIGHT_REGEX = /pr-\[([0-9.]+)px\]/gi;
// Non-deterministic value detection
const CLAMP_REGEX = /clamp\s*\(/i;
const CALC_REGEX = /calc\s*\(/i;
// Optional CSS custom properties (fallback)
const PAGE_FRAME_MAX_WIDTH_VAR_REGEX =
  /--contract-page-frame-max-width\s*:\s*([0-9.]+)\s*px/i;
const PAGE_FRAME_PADDING_VAR_REGEX =
  /--contract-page-frame-padding-x\s*:\s*([0-9.]+)\s*px/i;
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

const NAV_REGEX = /<nav\b/gi;
const HEADER_REGEX = /<header\b/gi;
const ASIDE_REGEX = /<aside\b/gi;
const PRIMITIVE_PATTERNS: Array<{ role: string; regex: RegExp }> = [
  { role: "nav", regex: NAV_REGEX },
  { role: "header", regex: HEADER_REGEX },
  { role: "sidebar", regex: ASIDE_REGEX },
];

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

  const layout = await extractLayout(
    layoutCssFiles,
    sectionFiles,
    workspaceRoot,
    fileContentCache,
    surface,
  );
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

  const primitives = await extractPrimitives(sectionFiles, workspaceRoot, fileContentCache);

  const structuralSurfaceDescriptor: SurfaceDescriptor = {
    surfaceId,
    sections,
    fonts,
    colors,
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
): Promise<SurfaceLayoutDescriptor> {
  let maxWidth: number | null = null;
  let layoutSource: string | undefined;

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

  return {
    maxContentWidth: maxWidth,
    containers: [...containers].sort(),
    containerSources: [...containerSources].sort(),
    source: layoutSource,
    pageFrame,
  };
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
      paddingLeftPx: null,
      paddingRightPx: null,
      source: undefined,
      maxWidthHasClampCalc: undefined,
      paddingHasClampCalc: undefined,
    };
  }

  let maxWidthPx: number | null = null;
  let paddingLeftPx: number | null = null;
  let paddingRightPx: number | null = null;
  let extractionSource: string | undefined;
  let maxWidthHasClampCalc = false;
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
  if (maxWidthPx === null || paddingLeftPx === null || paddingRightPx === null) {
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
  if (maxWidthPx === null || paddingLeftPx === null || paddingRightPx === null) {
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
  if (maxWidthPx === null || paddingLeftPx === null || paddingRightPx === null) {
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
    paddingLeftPx,
    paddingRightPx,
    source: extractionSource ?? containerSource,
    maxWidthHasClampCalc: maxWidthHasClampCalc || undefined,
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
