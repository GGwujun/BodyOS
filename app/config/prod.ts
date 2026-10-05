import type { UserConfigExport } from '@tarojs/cli';

export default {
  mini: {},
  h5: {
    /**
     * 生产环境如果 h5 部署在非根目录,修改 publicPath
     */
  }
} satisfies UserConfigExport;
