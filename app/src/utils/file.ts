import Taro from '@tarojs/taro';

/** 本地临时文件转 base64 数据 URL(按扩展名推断 mime,避免 png 被标成 jpeg) */
export async function fileToBase64(filePath: string): Promise<string> {
  const fs = Taro.getFileSystemManager();
  const base64 = fs.readFileSync(filePath, 'base64');
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}
