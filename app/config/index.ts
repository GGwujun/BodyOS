import { defineConfig } from '@tarojs/cli';
import path from 'path';
import devConfig from './dev';
import prodConfig from './prod';

export default defineConfig(async (merge) => {
  const base: import('@tarojs/cli').UserConfigExport = {
    projectName: 'bodyos-mini',
    date: '2026-8-13',
    designWidth: 375,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    alias: {
      '@': path.resolve(__dirname, '..', 'src')
    },
    plugins: [],
    defineConstants: {},
    copy: { patterns: [], options: {} },
    framework: 'react',
    compiler: 'webpack5',
    cache: { enable: false },
    mini: {
      webpackChain(chain) {
        // 移除进度条插件(webpackbar 与当前 webpack5 schema 不兼容会中断构建,
        // 它只影响终端进度条,与产物无关)
        chain.plugins.delete('webpackbar');
      },
      postcss: {
        pxtransform: { enable: true, config: {} },
        url: { enable: true, config: { limit: 1024 } },
        cssModules: { enable: false, config: { namingPattern: 'module', generateScopedName: '[name]__[local]___[hash:base64:5]' } }
      }
    },
    h5: {
      webpackChain(chain) {
        chain.plugins.delete('webpackbar');
      },
      publicPath: '/',
      staticDirectory: 'static',
      output: { filename: 'js/[name].[hash:8].js', chunkFilename: 'js/[name].[chunkhash:8].js' },
      miniCssExtractPluginOption: { ignoreOrder: true, filename: 'css/[name].[hash].css', chunkFilename: 'css/[name].[chunkhash].css' },
      postcss: {
        autoprefixer: { enable: true, config: {} },
        cssModules: { enable: false, config: { namingPattern: 'module', generateScopedName: '[name]__[local]___[hash:base64:5]' } }
      }
    },
    rn: { appName: 'taroDemo', postcss: { cssModules: { enable: false } } }
  };
  return merge({}, base, process.env.NODE_ENV === 'development' ? devConfig : prodConfig);
});
