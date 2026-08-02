/**
 * Volatile creator-console URLs and selectors.
 * Adjust after live Stage 0 discovery when the console UI changes.
 */

export const TOUTIAO_MP_ORIGIN = 'https://mp.toutiao.com';
export const TOUTIAO_MP_HOME_URL = `${TOUTIAO_MP_ORIGIN}/`;
export const TOUTIAO_MP_LOGIN_URL = `${TOUTIAO_MP_ORIGIN}/auth/page/login`;
export const TOUTIAO_MEDIA_INFO_URL = `${TOUTIAO_MP_ORIGIN}/mp/agw/media/get_media_info`;
export const TOUTIAO_ARTICLE_PUBLISH_URL = `${TOUTIAO_MP_ORIGIN}/profile_v4/graphic/publish`;
export const TOUTIAO_MICRO_PUBLISH_URL = `${TOUTIAO_MP_ORIGIN}/profile_v4/weitoutiao/publish`;

/** Title field candidates on the article editor. */
export const ARTICLE_TITLE_SELECTORS = [
  'textarea[placeholder*="请输入文章标题"]',
  'textarea[placeholder*="标题"]',
  'input[placeholder*="标题"]',
  'textarea[placeholder*="title" i]',
  'input[placeholder*="title" i]',
  '.title-input textarea',
  '.title-input input',
  '[class*="title"] textarea',
  '[class*="title"] input'
] as const;

/** Body editors (contenteditable or textarea). */
export const ARTICLE_CONTENT_SELECTORS = [
  '.ProseMirror[contenteditable="true"]',
  'div.ProseMirror',
  'div[contenteditable="true"]',
  '[class*="editor"] [contenteditable="true"]',
  'textarea[placeholder*="正文"]',
  'textarea[placeholder*="内容"]'
] as const;

export const MICRO_CONTENT_SELECTORS = [
  '.ProseMirror[contenteditable="true"]',
  'div.ProseMirror',
  'div[contenteditable="true"]',
  'textarea[placeholder*="分享"]',
  'textarea[placeholder*="微头条"]',
  'textarea[placeholder*="说点什么"]',
  '[class*="editor"] [contenteditable="true"]'
] as const;

export const KEYWORD_INPUT_SELECTORS = [
  'input[placeholder*="关键词"]',
  'input[placeholder*="标签"]',
  'input[placeholder*="keyword" i]',
  'input[placeholder*="tag" i]'
] as const;

export const COVER_INPUT_SELECTORS = [
  'input[type="file"][accept*="image"]',
  'input[type="file"]'
] as const;

/** Explicit draft buttons when present. Current console often auto-saves instead. */
export const DRAFT_BUTTON_NAMES = [/存草稿/, /保存草稿/] as const;
/** Live publish controls observed on profile_v4 graphic editor. */
export const PUBLISH_BUTTON_NAMES = [
  /预览并发布/,
  /确认发布/,
  /立即发布/,
  /^发布$/
] as const;

export const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_PUBLISH_DEADLINE_MS = 5 * 60 * 1000;
export const MAX_PUBLISH_CONTENT_BYTES = 1024 * 1024;
export const MAX_MICRO_IMAGES = 9;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Creator console title constraint: 2–30 characters. */
export const MIN_ARTICLE_TITLE_CHARS = 2;
export const MAX_ARTICLE_TITLE_CHARS = 30;
