// babel-preset-taro 已内置 React/TS 所需配置
module.exports = {
  presets: [
    ['taro', {
      framework: 'react',
      ts: true,
      compiler: 'webpack5'
    }]
  ]
};
