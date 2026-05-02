import VmdRenderModule from 'vue-markdown-design/es/render/index2.mjs';

const VmdRender = ((VmdRenderModule as { default?: TVmdRender }).default ??
    (VmdRenderModule as unknown as TVmdRender));

export { VmdRender };

