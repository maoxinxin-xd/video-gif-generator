# 视频关键帧 GIF 生成器

一个纯前端的视频处理工具，导入视频后，能够自动按照 1s 的间隔提取视频的关键帧进行预览。提供直观的视频时间轴与关键帧标记（Marker）系统，允许用户随时拖拽更改关键帧位置，增加或删除关键帧。系统会在右侧面板根据这些提取到的关键帧实时生成对应的 GIF 动图，支持一键下载。

## 特性

- 纯静态前端，基于 HTML + Vanilla JavaScript + Tailwind CSS + DaisyUI
- 暗黑玻璃态沉浸式设计，支持环境光动画
- 完全在浏览器中处理视频和生成 GIF，无需后端，保护隐私
- 内置 gifshot 库实现实时 GIF 图像合成

## 如何使用

可以直接通过 GitHub Pages 访问该工具，或者下载后在本地打开 `index.html` 即可使用。

## 部署到 GitHub Pages

1. **创建并推送到 GitHub 仓库**
   ```bash
   git init
   git add .
   git commit -m "init"
   gh repo create video-to-gif-generator --public --source . --remote origin --push
   ```

2. **启用 GitHub Pages**
   ```bash
   gh api -X POST repos/:owner/video-to-gif-generator/pages -f build_type=workflow
   ```

3. **等待 Workflow 自动构建发布**，或通过 Actions 面板查看状态。
