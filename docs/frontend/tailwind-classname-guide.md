# Tailwind CSS className 编写指南（Tailwind 4 + React + TypeScript）

## 核心原则：用语义化颜色，不要硬编码

```
❌ 错误  className="bg-[#f9f9f8] text-[#1a1a18]"    → 硬编码，无法切换主题
❌ 一般  className="bg-slate-50 text-slate-900"       → 用了 Tailwind 内置色，但语义不明确
✅ 推荐  className="bg-surface text-text-primary"     → 语义化，一键切换亮/暗色
```

---

## 一、颜色命名规范

在 `index.css` 的 `@theme` 中定义语义化颜色：

```css
@import "tailwindcss";

@theme {
  /* 背景色 */
  --color-surface: #ffffff;          /* 主背景（如页面、卡片） */
  --color-surface-alt: #f8fafb;      /* 次要背景（如侧边栏） */

  /* 文字色 */
  --color-text-primary: #0f172a;     /* 主文字 */
  --color-text-secondary: #64748b;   /* 次要文字（说明文字） */
  --color-text-muted: #94a3b8;       /* 占位符、禁用文字 */

  /* 边框色 */
  --color-border: #e2e8f0;           /* 通用边框 */

  /* 交互色 */
  --color-hover: #f1f5f9;            /* 悬停背景 */
  --color-accent: #3b82f6;           /* 强调色（按钮、链接） */
}
```

使用时直接写类名：`bg-surface`、`text-text-primary`、`border-border`

---

## 二、className 过长时的处理方案

### 方案 A：换行 + 分组注释（最推荐，简单直接）

```tsx
<div
  className={[
    // 布局
    "flex h-screen w-screen overflow-hidden",
    // 外观
    "bg-surface text-text-primary font-sans",
  ].join(" ")}
>
```

### 方案 B：提取为常量（适合复用的样式组合）

```tsx
// 在文件顶部或单独的 styles.ts 中
const layoutBase = "flex h-screen w-screen overflow-hidden"
const themeBase = "bg-surface text-text-primary font-sans"

// 使用
<div className={`${layoutBase} ${themeBase}`}>
```

### 方案 C：用 clsx / cn 处理条件样式（有条件切换时必用）

```bash
npm install clsx
```

```tsx
import { clsx } from "clsx"

// 基础用法：合并多个类名
<div className={clsx("flex h-screen", isOpen && "overflow-hidden")}>

// 对象语法：根据条件开关
<div className={clsx(
  "fixed right-0 top-0 h-screen w-80 transition-transform",
  isOpen ? "translate-x-0" : "translate-x-full"
)}>
```

### ❌ 不推荐的写法

```tsx
// 不推荐：模板字符串内嵌三元，可读性差
className={`fixed right-0 top-0 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}

// 不推荐：行内写超长字符串不换行
className="fixed right-0 top-0 h-screen w-80 border-l border-border bg-surface transition-transform duration-300 ease-in-out translate-x-0"
```

---

## 三、常用 Tailwind 类名速查

### 布局
| 类名 | CSS | 说明 |
|------|-----|------|
| `flex` | `display: flex` | 弹性布局 |
| `flex-1` | `flex: 1 1 0%` | 占满剩余空间 |
| `items-center` | `align-items: center` | 交叉轴居中 |
| `justify-center` | `justify-content: center` | 主轴居中 |
| `justify-between` | `justify-content: space-between` | 两端对齐 |

### 尺寸
| 类名 | CSS | 说明 |
|------|-----|------|
| `h-screen` | `height: 100vh` | 视口高度 |
| `w-screen` | `width: 100vw` | 视口宽度 |
| `w-full` | `width: 100%` | 父容器宽度 |
| `w-80` | `width: 20rem (320px)` | 固定宽度 |
| `size-10` | `width: 2.5rem; height: 2.5rem` | 宽高同时设置 |

### 间距（规律：数字 × 0.25rem = 实际值）
| 类名 | CSS | 说明 |
|------|-----|------|
| `p-6` | `padding: 1.5rem` | 内边距 |
| `px-6` | `padding-left/right: 1.5rem` | 水平内边距 |
| `py-4` | `padding-top/bottom: 1rem` | 垂直内边距 |
| `m-4` | `margin: 1rem` | 外边距 |

### 定位
| 类名 | CSS | 说明 |
|------|-----|------|
| `relative` | `position: relative` | 相对定位 |
| `fixed` | `position: fixed` | 固定定位 |
| `absolute` | `position: absolute` | 绝对定位 |
| `right-0` | `right: 0` | 右边距为 0 |
| `top-0` | `top: 0` | 上边距为 0 |

### 边框与圆角
| 类名 | CSS | 说明 |
|------|-----|------|
| `border-r` | `border-right: 1px solid` | 右边框 |
| `border-l` | `border-left: 1px solid` | 左边框 |
| `border-b` | `border-bottom: 1px solid` | 下边框 |
| `rounded` | `border-radius: 0.25rem` | 小圆角 |
| `rounded-full` | `border-radius: 9999px` | 完全圆形 |

### 过渡动画
| 类名 | CSS | 说明 |
|------|-----|------|
| `transition-transform` | 只过渡 transform | 性能最好 |
| `transition-colors` | 只过渡颜色 | 适合 hover |
| `duration-300` | `transition-duration: 300ms` | 过渡时长 |
| `ease-in-out` | 缓入缓出 | 自然的动画曲线 |

### 文字
| 类名 | CSS | 说明 |
|------|-----|------|
| `text-lg` | `font-size: 1.125rem` | 稍大文字 |
| `font-semibold` | `font-weight: 600` | 半粗体 |
| `font-sans` | 无衬线字体 | 系统默认 |

---

## 四、阅读顺序建议

当你看到一个很长的 className 时，按这个顺序理解：

```
1. 定位  → fixed / relative / absolute
2. 布局  → flex / grid / items-center
3. 尺寸  → h-screen / w-80 / size-10
4. 间距  → p-6 / px-4 / m-2 / right-0 / top-0
5. 边框  → border-l / rounded-full
6. 背景  → bg-surface
7. 文字  → text-text-primary / text-lg / font-semibold
8. 动画  → transition-transform / duration-300
9. 状态  → hover:bg-hover / focus:ring-2
```

**写 className 时也建议按这个顺序排列，方便自己和他人阅读。**