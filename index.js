// --- 插件元数据 ---
const PLUGIN_ID = 'html2canvas-pro';
const PLUGIN_NAME = 'html2canvas-pro-custom'; // 修改名称以示区别
const SCRIPT_VERSION = '4.0.0-custom'; // 新版本号

// --- [新功能] 自定义范围选择的状态变量 ---
let customSelectionState = 'none'; // 'none', 'selecting_start', 'selecting_end'
let startMessageElement = null;
let endMessageElement = null;

// --- 日志系统 (保留) ---
const captureLogger = {
  log: (message, level = 'info', data = null) => {
    const timer = new Date().toISOString();
    const supportedLevels = ['log', 'info', 'warn', 'error'];
    const consoleFunc = supportedLevels.includes(level) ? console[level] : console.log;
    consoleFunc(`[${timer.split('T')[1].slice(0, 12)}][${PLUGIN_NAME}] ${message}`, data || '');
  },
  info: (message, data) => captureLogger.log(message, 'info', data),
  warn: (message, data) => captureLogger.log(message, 'warn', data),
  error: (message, data) => captureLogger.log(message, 'error', data),
};

// --- 插件设置 (简化，保留核心参数，移除UI) ---
const STORAGE_KEY = 'modernScreenshotExtensionSettingsV2';
let settings = {};
const defaultSettings = {
  screenshotScale: 1.8,
  imageFormat: 'jpeg',
  imageQuality: 0.92,
  noBackground: false,
};

function loadSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const defaultStructure = { pluginSettings: { ...defaultSettings } };
    settings = stored ? { ...defaultStructure, ...JSON.parse(stored) } : { ...defaultStructure };
    if (!settings.pluginSettings) {
      settings.pluginSettings = { ...defaultSettings };
    }
  } catch (error) {
    captureLogger.error('加载设置失败，将使用默认设置。', error);
    settings = { pluginSettings: { ...defaultSettings } };
  }
}

function getPluginSettings() {
  return { ...defaultSettings, ...settings.pluginSettings };
}

// --- 核心配置 (保留) ---
const config = {
  chatContentSelector: '#chat',
  messageSelector: '.mes',
};

const OPTIMIZED_STYLE_PROPERTIES = new Set([
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'float',
  'clear',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-collapse',
  'border-spacing',
  'box-sizing',
  'overflow',
  'overflow-x',
  'overflow-y',
  'flex',
  'flex-basis',
  'flex-direction',
  'flex-flow',
  'flex-grow',
  'flex-shrink',
  'flex-wrap',
  'align-content',
  'align-items',
  'align-self',
  'justify-content',
  'justify-items',
  'justify-self',
  'gap',
  'row-gap',
  'column-gap',
  'grid',
  'grid-area',
  'grid-template',
  'grid-template-areas',
  'grid-template-rows',
  'grid-template-columns',
  'grid-row',
  'grid-row-start',
  'grid-row-end',
  'grid-column',
  'grid-column-start',
  'grid-column-end',
  'color',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-decoration',
  'text-indent',
  'text-transform',
  'text-shadow',
  'white-space',
  'vertical-align',
  'background',
  'background-color',
  'background-image',
  'background-repeat',
  'background-position',
  'background-size',
  'background-clip',
  'opacity',
  'visibility',
  'box-shadow',
  'outline',
  'outline-offset',
  'cursor',
  'transform',
  'transform-origin',
  'transform-style',
  'transition',
  'animation',
  'filter',
  'list-style',
  'list-style-type',
  'list-style-position',
  'list-style-image',
]);
const STYLE_WHITELIST_ARRAY = Array.from(OPTIMIZED_STYLE_PROPERTIES);

// --- 性能缓存与核心截图逻辑 (基本保留，不做大改动) ---
let CACHED_UNIT_BACKGROUND = null;
const FONT_DATA_MEMORY_CACHE = new Map();
const IMAGE_DATA_MEMORY_CACHE = new Map();
let ACTIVE_FONT_MAPPING = null;
let CACHED_FA_CSS = null;
const CSS_CONTENT_MEMORY_CACHE = new Map();
let PERSISTENT_SCREENSHOT_CONTEXT = null;

function invalidateUnitBackgroundCache() {
  if (CACHED_UNIT_BACKGROUND) {
    captureLogger.info('Cache invalidation: Unit background has been cleared.');
    CACHED_UNIT_BACKGROUND = null;
  }
}
function invalidateScreenshotContext() {
  if (PERSISTENT_SCREENSHOT_CONTEXT) {
    captureLogger.info('Cache invalidation: Screenshot context (Web Worker) is being destroyed.');
    if (window.modernScreenshot && typeof window.modernScreenshot.destroyContext === 'function') {
      window.modernScreenshot.destroyContext(PERSISTENT_SCREENSHOT_CONTEXT);
    }
    PERSISTENT_SCREENSHOT_CONTEXT = null;
  }
}

class AssetCacheManager {
  constructor(dbName = 'ModernScreenshotCache', version = 1) {
    this.db = null;
    this.dbName = dbName;
    this.dbVersion = 2;
    this.stores = { fontMappings: 'fontMappings', fontData: 'fontData', imageData: 'imageData' };
  }
  async init() {
    return new Promise((resolve, reject) => {
      if (this.db) return resolve();
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.stores.fontMappings)) {
          db.createObjectStore(this.stores.fontMappings, { keyPath: 'cssUrl' });
        }
        if (!db.objectStoreNames.contains(this.stores.fontData)) {
          db.createObjectStore(this.stores.fontData, { keyPath: 'fontUrl' });
        }
        if (!db.objectStoreNames.contains(this.stores.imageData)) {
          db.createObjectStore(this.stores.imageData, { keyPath: 'imageUrl' });
        }
      };
      request.onsuccess = event => {
        this.db = event.target.result;
        resolve();
      };
      request.onerror = event => {
        captureLogger.error('Failed to connect to asset cache database:', event.target.error);
        reject(event.target.error);
      };
    });
  }
  _getStore(storeName, mode = 'readonly') {
    const transaction = this.db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }
  async getAllFontData() {
    return new Promise((resolve, reject) => {
      const store = this._getStore(this.stores.fontData);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = e => reject(e.target.error);
    });
  }
  async getMapping(cssUrl) {
    return new Promise((resolve, reject) => {
      const store = this._getStore(this.stores.fontMappings);
      const request = store.get(cssUrl);
      request.onsuccess = () => resolve(request.result?.mapping);
      request.onerror = e => reject(e.target.error);
    });
  }
  async saveMapping(cssUrl, mapping) {
    return new Promise((resolve, reject) => {
      const store = this._getStore(this.stores.fontMappings, 'readwrite');
      const request = store.put({ cssUrl, mapping });
      request.onsuccess = () => resolve();
      request.onerror = e => reject(e.target.error);
    });
  }
  async getFontData(fontUrl) {
    return new Promise((resolve, reject) => {
      const store = this._getStore(this.stores.fontData);
      const request = store.get(fontUrl);
      request.onsuccess = () => resolve(request.result?.dataUrl);
      request.onerror = e => reject(e.target.error);
    });
  }
  async saveFontData(fontUrl, dataUrl) {
    return new Promise((resolve, reject) => {
      const store = this._getStore(this.stores.fontData, 'readwrite');
      const request = store.put({ fontUrl, dataUrl });
      request.onsuccess = () => resolve();
      request.onerror = e => reject(e.target.error);
    });
  }
  async getAllImageData() {
    return new Promise((resolve, reject) => {
      const store = this._getStore(this.stores.imageData);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = e => reject(e.target.error);
    });
  }
  async getImageData(imageUrl) {
    return new Promise((resolve, reject) => {
      const store = this._getStore(this.stores.imageData);
      const request = store.get(imageUrl);
      request.onsuccess = () => resolve(request.result?.dataUrl);
      request.onerror = e => reject(e.target.error);
    });
  }
  async saveImageData(imageUrl, dataUrl) {
    return new Promise((resolve, reject) => {
      const store = this._getStore(this.stores.imageData, 'readwrite');
      const request = store.put({ imageUrl, dataUrl });
      request.onsuccess = () => resolve();
      request.onerror = e => reject(e.target.error);
    });
  }
  async processFontFromStyleElement() {
    captureLogger.info('--- Font Processing Started ---');
    const styleElement = document.querySelector('#custom-style');
    if (!styleElement) {
      captureLogger.error(
        'Font Diagnosis: ABORTED. Critical: Could not find the <style id="custom-style"> element. No custom fonts can be processed.',
      );
      return;
    }
    const rawCss = styleElement.textContent || '';
    if (!rawCss.trim()) {
      captureLogger.warn(
        'Font Diagnosis: ABORTED. The #custom-style element was found but is empty. No custom fonts to process.',
      );
      return;
    }
    captureLogger.info('Font Diagnosis: Found #custom-style. Content (first 200 chars):', rawCss.substring(0, 200));
    const importMatch = /@import\s+url\((['"]?)(.*?)\1\);/g.exec(rawCss);
    let cssContent;
    let baseUrl;
    let styleIdentifier;
    if (importMatch) {
      styleIdentifier = importMatch[2];
      baseUrl = styleIdentifier;
      captureLogger.info(`Font Diagnosis: Detected external font CSS via @import. URL: ${styleIdentifier}`);
    } else if (rawCss.includes('@font-face')) {
      styleIdentifier = 'inline-style:' + rawCss.trim();
      baseUrl = window.location.href;
      cssContent = rawCss;
      captureLogger.info('Font Diagnosis: Detected inline @font-face rules inside #custom-style.');
    } else {
      captureLogger.warn(
        'Font Diagnosis: ABORTED. No @import or inline @font-face rules found within #custom-style. System will use default fonts.',
      );
      ACTIVE_FONT_MAPPING = null;
      return;
    }
    if (ACTIVE_FONT_MAPPING && ACTIVE_FONT_MAPPING.cssUrl === styleIdentifier) {
      captureLogger.info(
        `Font Diagnosis: Mapping for "${styleIdentifier.substring(0, 70)}..." is already active in memory. Skipping.`,
      );
      return;
    }
    const dbMapping = await assetCacheManager.getMapping(styleIdentifier);
    if (dbMapping) {
      ACTIVE_FONT_MAPPING = { cssUrl: styleIdentifier, mapping: dbMapping };
      captureLogger.info(
        `Font Diagnosis: Font mapping loaded from DB cache into memory: ${styleIdentifier.substring(0, 70)}...`,
      );
      return;
    }
    if (!cssContent) {
      try {
        captureLogger.info(`Font Diagnosis: Downloading external CSS content from: ${styleIdentifier}`);
        cssContent = await fetch(styleIdentifier).then(res => res.text());
      } catch (error) {
        captureLogger.error(`Font Diagnosis: FAILED to download external font CSS: ${styleIdentifier}`, error);
        return;
      }
    }
    try {
      captureLogger.info(`Font Diagnosis: Creating new font mapping for style: ${styleIdentifier.substring(0, 70)}...`);
      const fontFaceRegex = /@font-face\s*{([^}]*)}/g;
      const unicodeRangeRegex = /unicode-range:\s*([^;]*);/;
      const urlRegex = /url\((['"]?)(.*?)\1\)/;
      const mapping = {};
      let match;
      let rulesFound = 0;
      fontFaceRegex.lastIndex = 0;
      while ((match = fontFaceRegex.exec(cssContent)) !== null) {
        rulesFound++;
        const fontFaceBlock = match[1];
        const urlMatch = fontFaceBlock.match(urlRegex);
        if (urlMatch) {
          const fontFileUrl = new URL(urlMatch[2], baseUrl).href;
          const unicodeRangeMatch = fontFaceBlock.match(unicodeRangeRegex);
          if (unicodeRangeMatch) {
            const ranges = unicodeRangeMatch[1];
            ranges.split(',').forEach(range => {
              range = range.trim().toUpperCase().substring(2);
              if (range.includes('-')) {
                const [start, end] = range.split('-').map(hex => parseInt(hex, 16));
                for (let i = start; i <= end; i++) {
                  mapping[i] = fontFileUrl;
                }
              } else {
                mapping[parseInt(range, 16)] = fontFileUrl;
              }
            });
          } else {
            mapping['default'] = fontFileUrl;
          }
        }
      }
      captureLogger.info(`Font Diagnosis: Scanned CSS content. Found ${rulesFound} @font-face rules.`);
      if (Object.keys(mapping).length > 0) {
        await assetCacheManager.saveMapping(styleIdentifier, mapping);
        ACTIVE_FONT_MAPPING = { cssUrl: styleIdentifier, mapping: mapping };
        captureLogger.info(
          `Font Diagnosis: SUCCESS. Font mapping created with ${Object.keys(mapping).length} entries and saved.`,
        );
      } else {
        captureLogger.error(
          'Font Diagnosis: FAILED. Found @font-face rules but could not parse any valid font URLs from them.',
        );
      }
    } catch (error) {
      captureLogger.error(`Font Diagnosis: FAILED during style processing: ${styleIdentifier}`, error);
    }
  }
}
const assetCacheManager = new AssetCacheManager();

async function getFontDataUrlAsync(fontUrl) {
  if (FONT_DATA_MEMORY_CACHE.has(fontUrl)) return FONT_DATA_MEMORY_CACHE.get(fontUrl);
  let dataUrl = await assetCacheManager.getFontData(fontUrl);
  if (dataUrl) {
    FONT_DATA_MEMORY_CACHE.set(fontUrl, dataUrl);
    return dataUrl;
  }
  captureLogger.info(`Downloading and caching font: ${fontUrl}`);
  try {
    const fontBlob = await fetch(fontUrl).then(res => (res.ok ? res.blob() : Promise.reject(`HTTP ${res.status}`)));
    dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(fontBlob);
    });
    FONT_DATA_MEMORY_CACHE.set(fontUrl, dataUrl);
    await assetCacheManager.saveFontData(fontUrl, dataUrl);
    return dataUrl;
  } catch (err) {
    captureLogger.error(`Failed to download font: ${fontUrl}`, err);
    return null;
  }
}
async function customImageFetchFn(url) {
  const logPrefix = '[Image Fetch]';
  if (!url || typeof url !== 'string' || url.startsWith('data:')) return false;
  try {
    new URL(url, window.location.origin);
  } catch (e) {
    return false;
  }

  if (IMAGE_DATA_MEMORY_CACHE.has(url)) return IMAGE_DATA_MEMORY_CACHE.get(url);
  let dataUrl = await assetCacheManager.getImageData(url);
  if (dataUrl) {
    IMAGE_DATA_MEMORY_CACHE.set(url, dataUrl);
    return dataUrl;
  }
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return Promise.reject(`HTTP ${response.status} for ${url}`);
    const imageBlob = await response.blob();
    dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(imageBlob);
    });
    IMAGE_DATA_MEMORY_CACHE.set(url, dataUrl);
    await assetCacheManager.saveImageData(url, dataUrl);
    return dataUrl;
  } catch (err) {
    captureLogger.error(`${logPrefix} CRITICAL EXCEPTION during network fetch.`, { url, errorMessage: err.message });
    return false;
  }
}
async function getFontAwesomeCssAsync() {
  if (CACHED_FA_CSS) return CACHED_FA_CSS;
  const fontFaceRules = [];
  for (const sheet of document.styleSheets) {
    try {
      if (!sheet.cssRules) continue;
      for (const rule of sheet.cssRules) {
        if (rule.type === CSSRule.FONT_FACE_RULE && rule.style.fontFamily.includes('Font Awesome')) {
          fontFaceRules.push(rule);
        }
      }
    } catch (e) {
      continue;
    }
  }
  if (fontFaceRules.length === 0) return '';
  const fontUrlRegex = /url\((['"]?)(.+?)\1\)/g;
  const processedRulesPromises = fontFaceRules.map(async rule => {
    let processedRule = rule.cssText;
    const fontUrlMatches = [...rule.cssText.matchAll(fontUrlRegex)];
    for (const urlMatch of fontUrlMatches) {
      const absoluteFontUrl = new URL(urlMatch[2], rule.parentStyleSheet.href || window.location.href).href;
      const fontDataUrl = await getFontDataUrlAsync(absoluteFontUrl);
      if (fontDataUrl) {
        processedRule = processedRule.replace(urlMatch[0], `url("${fontDataUrl}")`);
      }
    }
    return processedRule;
  });
  CACHED_FA_CSS = (await Promise.all(processedRulesPromises)).join('\n');
  return CACHED_FA_CSS;
}
async function getSubsettedFontCssAsync(text) {
  if (!ACTIVE_FONT_MAPPING) return '';
  const { cssUrl, mapping } = ACTIVE_FONT_MAPPING;
  const requiredFontUrls = new Set();
  if (mapping['default']) requiredFontUrls.add(mapping['default']);
  for (const char of text) {
    if (mapping[char.charCodeAt(0)]) requiredFontUrls.add(mapping[char.charCodeAt(0)]);
  }
  if (requiredFontUrls.size === 0) return '';
  const urlToDataUrlMap = new Map();
  await Promise.all(
    [...requiredFontUrls].map(async url => {
      const dataUrl = await getFontDataUrlAsync(url);
      if (dataUrl) urlToDataUrlMap.set(url, dataUrl);
    }),
  );
  let cssContent, baseUrl;
  if (cssUrl.startsWith('inline-style:')) {
    cssContent = cssUrl.substring('inline-style:'.length);
    baseUrl = window.location.href;
  } else {
    if (CSS_CONTENT_MEMORY_CACHE.has(cssUrl)) {
      cssContent = CSS_CONTENT_MEMORY_CACHE.get(cssUrl);
    } else {
      cssContent = await fetch(cssUrl).then(res => res.text());
      CSS_CONTENT_MEMORY_CACHE.set(cssUrl, cssContent);
    }
    baseUrl = cssUrl;
  }
  const requiredCssRules = [];
  const fontFaceRegex = /@font-face\s*{[^}]*}/g;
  let match;
  while ((match = fontFaceRegex.exec(cssContent)) !== null) {
    const rule = match[0];
    const urlMatch = /url\((['"]?)(.*?)\1\)/.exec(rule);
    if (urlMatch) {
      const fontFileUrl = new URL(urlMatch[2], baseUrl).href;
      if (urlToDataUrlMap.has(fontFileUrl)) {
        requiredCssRules.push(rule.replace(urlMatch[0], `url("${urlToDataUrlMap.get(fontFileUrl)}")`));
      }
    }
  }
  return requiredCssRules.join('\n');
}
function findActiveBackgroundElement() {
  const selectors = [
    '#bg_animation_container > div[id^="bg"]',
    '#background > div[id^="bg"]',
    '#bg1',
    '#bg_animation_container',
    '#background',
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).backgroundImage !== 'none')
      return el;
  }
  return document.querySelector(config.chatContentSelector);
}
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = err => reject(new Error('Image load failed', { cause: err }));
    img.src = dataUrl;
  });
}
async function createUnitBackgroundAsync(scale) {
  const currentSettings = getPluginSettings();
  const chatContainer = document.querySelector(config.chatContentSelector);
  if (!chatContainer) throw new Error('Cannot find #chat element!');
  const formSheld = document.querySelector('#form_sheld');
  const chatRect = chatContainer.getBoundingClientRect();
  const formSheldHeight = formSheld ? formSheld.offsetHeight : 0;
  const unitWidth = chatContainer.clientWidth;
  const unitHeight = chatRect.height - formSheldHeight;
  if (currentSettings.noBackground) {
    const transparentCanvas = document.createElement('canvas');
    transparentCanvas.width = unitWidth * scale;
    transparentCanvas.height = unitHeight * scale;
    return transparentCanvas;
  }
  if (CACHED_UNIT_BACKGROUND) {
    const clonedCanvas = document.createElement('canvas');
    clonedCanvas.width = CACHED_UNIT_BACKGROUND.width;
    clonedCanvas.height = CACHED_UNIT_BACKGROUND.height;
    clonedCanvas.getContext('2d').drawImage(CACHED_UNIT_BACKGROUND, 0, 0);
    return clonedCanvas;
  }
  const backgroundHolder = findActiveBackgroundElement();
  const unitTop = chatRect.top;
  const unitLeft = chatContainer.getBoundingClientRect().left;
  const hiddenElements = [];
  let fullBackgroundDataUrl;
  try {
    ['#chat', '#form_sheld', '.header', '#right-panel', '#left-panel', '#character-popup'].forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (el.style.visibility !== 'hidden') {
          el.style.visibility = 'hidden';
          hiddenElements.push(el);
        }
      });
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    fullBackgroundDataUrl = await window.modernScreenshot.domToDataUrl(backgroundHolder, {
      scale,
      includeStyleProperties: STYLE_WHITELIST_ARRAY,
      fetchFn: customImageFetchFn,
    });
  } finally {
    hiddenElements.forEach(el => {
      el.style.visibility = 'visible';
    });
  }
  if (!fullBackgroundDataUrl) throw new Error('Background capture failed.');
  const fullBgImage = await loadImage(fullBackgroundDataUrl);
  const unitCanvas = document.createElement('canvas');
  unitCanvas.width = unitWidth * scale;
  unitCanvas.height = unitHeight * scale;
  const unitCtx = unitCanvas.getContext('2d');
  unitCtx.drawImage(
    fullBgImage,
    unitLeft * scale,
    unitTop * scale,
    unitWidth * scale,
    unitHeight * scale,
    0,
    0,
    unitWidth * scale,
    unitHeight * scale,
  );
  CACHED_UNIT_BACKGROUND = unitCanvas;
  const returnedCanvas = document.createElement('canvas');
  returnedCanvas.width = unitCanvas.width;
  returnedCanvas.height = unitCanvas.height;
  returnedCanvas.getContext('2d').drawImage(unitCanvas, 0, 0);
  return returnedCanvas;
}
async function captureLongScreenshot(elementsToCapture) {
  if (!elementsToCapture || elementsToCapture.length === 0) {
    throw new Error('No elements provided for screenshot.');
  }
  const currentSettings = getPluginSettings();
  const scale = currentSettings.screenshotScale;
  const allTextContent = elementsToCapture.map(el => el.textContent || '').join('');
  const [subsettedCss, faCss] = await Promise.all([getSubsettedFontCssAsync(allTextContent), getFontAwesomeCssAsync()]);
  const combinedCss = `${subsettedCss}\n${faCss}`;
  let totalHeight = 0,
    maxWidth = 0;
  elementsToCapture.forEach(el => {
    const rect = el.getBoundingClientRect();
    totalHeight += rect.height;
    if (el.clientWidth > maxWidth) maxWidth = el.clientWidth;
  });
  const messageMargin = elementsToCapture.length > 1 ? 5 : 0;
  totalHeight += (elementsToCapture.length - 1) * messageMargin;
  const finalWidth = maxWidth * scale;
  const finalHeight = totalHeight * scale;
  let effectiveFormat = currentSettings.imageFormat;
  if (effectiveFormat === 'webp' && (finalWidth > 16000 || finalHeight > 16000)) {
    effectiveFormat = 'jpeg';
    toastr.warning('截图过长，已自动切换到JPEG格式。', '格式回退', { timeOut: 5000 });
  }
  const unitBgCanvas = await createUnitBackgroundAsync(scale);
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = finalWidth;
  finalCanvas.height = finalHeight;
  const finalCtx = finalCanvas.getContext('2d');
  if (!currentSettings.noBackground) {
    const pattern = finalCtx.createPattern(unitBgCanvas, 'repeat-y');
    finalCtx.fillStyle = pattern;
    finalCtx.fillRect(0, 0, finalWidth, finalHeight);
  }
  const lib = window.modernScreenshot;
  const context = await lib.createContext(elementsToCapture[0], {
    scale,
    font: false,
    includeStyleProperties: STYLE_WHITELIST_ARRAY,
    style: { margin: '0' },
    features: { restoreScrollPosition: true },
    fetchFn: customImageFetchFn,
    onCreateForeignObjectSvg: svg => {
      const styleElement = document.createElement('style');
      styleElement.textContent = combinedCss + '\n' + 'q::before, q::after { content: none !important; }';
      svg.querySelector('defs')?.appendChild(styleElement) ||
        svg.prepend(Object.assign(document.createElement('defs'), { innerHTML: styleElement.outerHTML }));
    },
    workerUrl: `/scripts/extensions/third-party/${PLUGIN_ID}/worker.js`,
    autoDestruct: false,
  });
  let currentY = 0;
  for (const element of elementsToCapture) {
    const rect = element.getBoundingClientRect();
    context.node = element;
    context.width = rect.width;
    context.height = rect.height;
    const sectionCanvas = await lib.domToCanvas(context);
    const offsetX = (finalWidth - sectionCanvas.width) / 2;
    finalCtx.drawImage(sectionCanvas, offsetX, currentY);
    currentY += rect.height * scale + messageMargin * scale;
  }
  lib.destroyContext(context);
  return finalCanvas.toDataURL('image/' + effectiveFormat, currentSettings.imageQuality);
}
async function executeScreenshot(elements) {
  if (!elements || elements.length === 0) {
    toastr.warning('没有需要截图的消息。');
    return;
  }
  try {
    const dataUrl = await captureLongScreenshot(elements);
    const link = document.createElement('a');
    const extension = dataUrl.substring('data:image/'.length, dataUrl.indexOf(';'));
    link.download = `SillyTavern_Range_${new Date()
      .toISOString()
      .replace(/[:.T-]/g, '')
      .slice(0, 14)}.${extension}`;
    link.href = dataUrl;
    link.click();
  } catch (error) {
    captureLogger.error('Screenshot execution failed:', error);
    toastr.error('截图失败，请查看控制台获取更多信息。');
  }
}
async function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Script load failed: ${src}`));
    document.head.appendChild(script);
  });
}

// --- [新功能] 悬浮UI和自定义范围选择逻辑 ---

/**
 * 初始化悬浮UI和入口按钮
 */
function initFloatingScreenshotUI() {
  const FLOATING_UI_ID = 'st-custom-screenshot-panel';
  const STYLE_ID = 'st-custom-screenshot-styles';

  if ($(`#${STYLE_ID}`).length > 0) return;

  const styles = `
        <style id="${STYLE_ID}">
            #${FLOATING_UI_ID} {
                position: fixed; bottom: 80px; right: 20px; z-index: 9990;
                background-color: var(--SmartThemeBody, #1c1c1c);
                border: 1px solid var(--SmartThemeBorderColor, #444);
                border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                display: flex; flex-direction: column; gap: 8px; padding: 10px;
                transition: opacity 0.3s ease, transform 0.3s ease;
                opacity: 0; transform: scale(0.95); pointer-events: none;
            }
            #${FLOATING_UI_ID}.visible {
                opacity: 1; transform: scale(1); pointer-events: auto;
            }
            #${FLOATING_UI_ID} button {
                background-color: var(--SmartThemeMid, #2a2a2a);
                color: var(--SmartThemeBodyColor, #e0e0e0);
                border: 1px solid var(--SmartThemeBorderColor, #444);
                padding: 8px 12px; border-radius: 8px; cursor: pointer;
                transition: background-color 0.2s, color 0.2s;
                display: flex; align-items: center; gap: 8px; font-size: 14px; white-space: nowrap;
            }
            #${FLOATING_UI_ID} button:hover {
                background-color: var(--SmartThemeQuoteColor, #8cdeff);
                color: #000;
            }
            #${FLOATING_UI_ID} button:disabled { opacity: 0.5; cursor: not-allowed; }
            #${FLOATING_UI_ID} button.active-selection { background-color: #ff9800; color: #000; font-weight: bold; }
            .message-selecting-mode #chat { cursor: crosshair !important; }
            .screenshot-range-selected {
                outline: 2px dashed #ff9800 !important;
                outline-offset: -2px;
                background-color: rgba(255, 152, 0, 0.15) !important;
            }
        </style>
    `;

  const uiHtml = `
        <div id="${FLOATING_UI_ID}">
            <button id="st-ss-set-start-btn"><i class="fa-solid fa-arrow-down-to-line"></i> <span>设置起点</span></button>
            <button id="st-ss-set-end-btn"><i class="fa-solid fa-arrow-up-from-line"></i> <span>设置终点</span></button>
            <button id="st-ss-capture-btn" disabled><i class="fa-solid fa-camera"></i> <span>生成截图</span></button>
            <button id="st-ss-cancel-btn" style="display:none;"><i class="fa-solid fa-xmark"></i> <span>取消选择</span></button>
        </div>
    `;

  $('head').append(styles);
  $('body').append(uiHtml);

  const toggleButton = $(
    `<div id="custom_screenshot_toggle_button" class="menu_button"><i class="fa-solid fa-crop-simple"></i><span class="menu_button_text"> 范围截图</span></div>`,
  );
  $('#chat_menu_buttons').append(toggleButton);

  toggleButton.on('click', () => {
    const panel = $(`#${FLOATING_UI_ID}`);
    if (panel.hasClass('visible')) {
      panel.removeClass('visible');
      resetCustomSelection();
    } else {
      panel.addClass('visible');
    }
  });

  bindFloatingButtonEvents();
}

/**
 * 为悬浮UI的按钮绑定事件
 */
function bindFloatingButtonEvents() {
  const $body = $('body');
  const $chat = $(config.chatContentSelector);

  $body.on('click', '#st-ss-set-start-btn', function () {
    customSelectionState = 'selecting_start';
    updateFloatingButtonsUI();
    $body.addClass('message-selecting-mode');
    toastr.info('请在聊天记录中点击一条消息作为截图的起点。');
  });

  $body.on('click', '#st-ss-set-end-btn', function () {
    customSelectionState = 'selecting_end';
    updateFloatingButtonsUI();
    $body.addClass('message-selecting-mode');
    toastr.info('请在聊天记录中点击一条消息作为截图的终点。');
  });

  $body.on('click', '#st-ss-cancel-btn', function () {
    resetCustomSelection();
  });

  $body.on('click', '#st-ss-capture-btn', async function () {
    if (!startMessageElement || !endMessageElement) {
      toastr.error('请先选择起点和终点。');
      return;
    }

    const elements = getElementsInRange(startMessageElement, endMessageElement);
    if (elements.length > 0) {
      const button = this;
      const originalContent = button.innerHTML;
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>正在生成...</span>';
      button.disabled = true;

      try {
        await executeScreenshot(elements);
      } catch (error) {
        captureLogger.error('Custom range screenshot failed.', error);
        toastr.error('范围截图生成失败，请查看控制台日志。');
      } finally {
        button.innerHTML = originalContent;
        resetCustomSelection();
      }
    }
  });

  $chat.on('click', '.mes', function (event) {
    if (customSelectionState === 'none') return;
    event.stopPropagation();
    const clickedMessage = this;

    if (customSelectionState === 'selecting_start') {
      startMessageElement = clickedMessage;
      toastr.success('起点已设置！');
    } else if (customSelectionState === 'selecting_end') {
      endMessageElement = clickedMessage;
      toastr.success('终点已设置！');
    }

    customSelectionState = 'none';
    $body.removeClass('message-selecting-mode');
    updateHighlightsAndUI();
  });
}

/**
 * 重置所有选择和UI状态
 */
function resetCustomSelection() {
  customSelectionState = 'none';
  startMessageElement = null;
  endMessageElement = null;
  $('body').removeClass('message-selecting-mode');
  $('.screenshot-range-selected').removeClass('screenshot-range-selected');
  updateFloatingButtonsUI();
}

/**
 * 根据当前状态更新悬浮按钮的显示
 */
function updateFloatingButtonsUI() {
  const startBtn = $('#st-ss-set-start-btn');
  const endBtn = $('#st-ss-set-end-btn');
  const captureBtn = $('#st-ss-capture-btn');
  const cancelBtn = $('#st-ss-cancel-btn');

  $('button.active-selection').removeClass('active-selection');

  if (customSelectionState === 'selecting_start') startBtn.addClass('active-selection');
  else if (customSelectionState === 'selecting_end') endBtn.addClass('active-selection');

  startBtn.find('span').text(startMessageElement ? '重设起点' : '设置起点');
  endBtn.find('span').text(endMessageElement ? '重设终点' : '设置终点');

  captureBtn.prop('disabled', !(startMessageElement && endMessageElement));
  cancelBtn.toggle(!!(startMessageElement || endMessageElement));
}

/**
 * 更新高亮显示并刷新UI
 */
function updateHighlightsAndUI() {
  $('.screenshot-range-selected').removeClass('screenshot-range-selected');

  if (startMessageElement && endMessageElement) {
    const elements = getElementsInRange(startMessageElement, endMessageElement);
    $(elements).addClass('screenshot-range-selected');
  } else if (startMessageElement) {
    $(startMessageElement).addClass('screenshot-range-selected');
  } else if (endMessageElement) {
    $(endMessageElement).addClass('screenshot-range-selected');
  }
  updateFloatingButtonsUI();
}

/**
 * 获取两个DOM元素之间的所有 .mes 消息元素
 */
function getElementsInRange(el1, el2) {
  const allMessages = Array.from(document.querySelectorAll(config.messageSelector));
  const index1 = allMessages.indexOf(el1);
  const index2 = allMessages.indexOf(el2);
  if (index1 === -1 || index2 === -1) return [];
  const startIndex = Math.min(index1, index2);
  const endIndex = Math.max(index1, index2);
  return allMessages.slice(startIndex, endIndex + 1);
}

// --- 插件初始化入口 ---
async function initializePlugin() {
  try {
    captureLogger.info(`Plugin core initialization starting... (v${SCRIPT_VERSION})`);
    loadSettings();
    const libPromise = loadScript(`/scripts/extensions/third-party/${PLUGIN_ID}/modern-screenshot.umd.js`);
    const dbInitPromise = assetCacheManager.init();
    await Promise.all([libPromise, dbInitPromise]);
    if (!window.modernScreenshot?.domToDataUrl) throw new Error('Modern Screenshot library failed to load!');

    await assetCacheManager.processFontFromStyleElement();

    // 初始化你想要的悬浮UI
    initFloatingScreenshotUI();

    const chatContainer = document.querySelector(config.chatContentSelector);
    if (chatContainer) {
      const resizeObserver = new ResizeObserver(() => {
        invalidateUnitBackgroundCache();
        invalidateScreenshotContext();
      });
      resizeObserver.observe(chatContainer);
    }
    captureLogger.info('Plugin initialized successfully.');
  } catch (error) {
    captureLogger.error('A critical error occurred during plugin initialization:', error);
  }
}

jQuery(async () => {
  let isInitialized = false;
  const runInitialization = () => {
    if (isInitialized) return;
    isInitialized = true;
    initializePlugin();
  };
  if (
    typeof window.eventSource !== 'undefined' &&
    typeof window.event_types !== 'undefined' &&
    window.event_types.APP_READY
  ) {
    window.eventSource.on(window.event_types.APP_READY, runInitialization);
  } else {
    setTimeout(runInitialization, 1000);
  }
});
