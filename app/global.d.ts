/// <reference types="@tarojs/taro" />

declare module '*.png';
declare module '*.gif';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.svg';
declare module '*.css';
declare module '*.less';
declare module '*.scss';
declare module '*.sass';
declare module '*.styl';

declare const process: {
  env: {
    [key: string]: string | undefined;
    TARO_ENV: 'weapp' | 'h5' | 'rn' | string;
    [key: `TARO_PLATFORM_${string}`]: string | undefined;
  };
};
