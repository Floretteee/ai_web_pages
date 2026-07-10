// 文字揭示动画工具 — 基于 Web Animations API，零依赖
// 参考：openagents、magicui、opencode 等项目的 stagger reveal 模式

const EASE_EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_BOUNCE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

const VARIANTS = {
  slideUp: [
    { opacity: '0', transform: 'translateY(24px) scale(0.96)', filter: 'blur(4px)' },
    { opacity: '1', transform: 'translateY(0) scale(1)', filter: 'blur(0px)' }
  ],
  fade: [
    { opacity: '0' },
    { opacity: '1' }
  ],
  scale: [
    { opacity: '0', transform: 'scale(0.92)', filter: 'blur(2px)' },
    { opacity: '1', transform: 'scale(1)', filter: 'blur(0px)' }
  ],
  slideDown: [
    { opacity: '0', transform: 'translateY(-12px)', filter: 'blur(2px)' },
    { opacity: '1', transform: 'translateY(0)', filter: 'blur(0px)' }
  ],
};

const CHUNK_KEYFRAMES = [
  { opacity: '0', transform: 'translateY(3px) scale(0.98)', filter: 'blur(2px)' },
  { opacity: '1', transform: 'translateY(0) scale(1)', filter: 'blur(0px)' }
];

/**
 * 以 stagger 方式揭示容器内直接子元素（段落、标题等块级元素）
 * @param {Element} container — 包含多个子元素的容器（如 .message 的 contentNode）
 * @param {object} opts
 */
function staggerRevealChildren(container, opts = {}) {
  const {
    variant = 'slideUp',
    duration = 500,
    staggerMs = 55,
    delay = 0,
  } = opts;

  const children = Array.from(container.children);
  if (!children.length) return;

  const keyframes = VARIANTS[variant] || VARIANTS.slideUp;

  // 先设置 inline opacity: 0 防止闪烁，WAAPI 会在第一个关键帧覆盖
  children.forEach(child => {
    child.style.opacity = '0';
    child.style.willChange = 'transform, opacity, filter';
  });

  const animations = children.map((child, i) => {
    const anim = child.animate(keyframes, {
      duration,
      delay: delay + i * staggerMs,
      fill: 'backwards',
      easing: variant === 'scale' ? EASE_BOUNCE : EASE_SPRING,
    });
    anim.onfinish = () => {
      child.style.willChange = '';
      child.style.opacity = '';
    };
    return anim;
  });

  // 整体完成时清理
  const lastIdx = children.length - 1;
  const totalTime = delay + lastIdx * staggerMs + duration;
  setTimeout(() => {
    children.forEach(child => {
      child.style.willChange = '';
      child.style.opacity = '';
    });
  }, totalTime + 50);

  return animations;
}

/**
 * 揭示单个流式文本块（用于 stream-new-chunk）
 * @param {Element} el — span 元素
 */
function revealChunk(el) {
  el.style.willChange = 'transform, opacity, filter';
  const anim = el.animate(CHUNK_KEYFRAMES, {
    duration: 280,
    fill: 'backwards',
    easing: EASE_EXPO_OUT,
  });
  anim.onfinish = () => {
    el.style.willChange = '';
  };
  return anim;
}

/**
 * 对消息列表中的每条消息内容应用 stagger 揭示
 * @param {Element[]} contentNodes — 消息内容 .message 元素数组
 * @param {object} opts
 */
function staggerMessageContents(contentNodes, opts = {}) {
  const {
    variant = 'slideUp',
    duration = 450,
    staggerMs = 40,
    interMessageDelay = 30,
  } = opts;

  let globalDelay = 0;

  contentNodes.forEach((contentNode, i) => {
    const children = Array.from(contentNode.children);
    if (!children.length) return;

    children.forEach(child => {
      child.style.opacity = '0';
      child.style.willChange = 'transform, opacity, filter';
    });

    const keyframes = VARIANTS[variant] || VARIANTS.slideUp;

    children.forEach((child, j) => {
      const anim = child.animate(keyframes, {
        duration,
        delay: globalDelay + j * staggerMs,
        fill: 'backwards',
        easing: EASE_SPRING,
      });
      anim.onfinish = () => {
        child.style.willChange = '';
        child.style.opacity = '';
      };
    });

    globalDelay += interMessageDelay;
  });

  return globalDelay;
}

// 挂载到 window 供其他脚本使用
window.TextAnim = {
  staggerRevealChildren,
  staggerMessageContents,
  revealChunk,
  VARIANTS,
  EASE_EXPO_OUT,
  EASE_SPRING,
  EASE_BOUNCE,
};
