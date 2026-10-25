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
    defineConstants: {
      // 后端基址可以在构建时覆盖 —— 换局域网 IP、接测试环境都不必改源码:
      //   API_BASE=http://192.168.1.5:3000/api/v1 npm run build:weapp
      // 必须在这里注入,不能靠源码里读 process.env.API_BASE:小程序运行时**没有 process**,
      // 而 TARO_ENV / NODE_ENV 之所以读得到,正是因为 Taro 把这类常量在打包时内联了 ——
      // 这一条走的是同一条路。空串表示没给,由 src/config 回落到各自的默认值。
      'process.env.API_BASE': JSON.stringify(process.env.API_BASE || '')
    },
    copy: {
      patterns: [
        // tabBar 图标不经过 webpack 编译,直接复制到产物目录(app.config.ts 引用)
        { from: 'src/assets/tabbar/', to: 'dist/assets/tabbar/', ignore: ['*.html'] },
        // theme.json 原样拷到 dist 根 —— app.config.ts 里 themeLocation 指的是它
        { from: 'src/theme.json', to: 'dist/theme.json' },
        // sitemap.json(搜一搜收录规则)也走同一条路:微信只认包根的这份文件
        { from: 'src/sitemap.json', to: 'dist/sitemap.json' }
      ],
      options: {}
    },
    framework: 'react',
    compiler: 'webpack5',
    cache: { enable: false },
    mini: {
      webpackChain(chain) {
        // 移除进度条插件(webpackbar 与当前 webpack5 schema 不兼容会中断构建,
        // 它只影响终端进度条,与产物无关)
        chain.plugins.delete('webpackbar');
      },
      // @ts-expect-error Taro 3.6 的类型定义没收录 terser,运行时(MiniBaseConfig)支持
      terser: {
        config: {
          output: {
            // Taro 默认 ascii_only:true,中文会被压成转义序列(每个汉字 6 字节),
            // 而 UTF-8 原文只要 3 字节 —— 动作库 1324 条数据光这一项就白占 440KB,
            // 直接把 pkg-exercise 顶过了 2MB 分包上限。小程序运行时(V8/JSCore)读 UTF-8
            // 没问题,关掉转义。
            ascii_only: false
          }
        }
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
