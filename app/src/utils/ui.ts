import Taro from '@tarojs/taro';

/** 二次确认(docs/02:删除健康数据需二次确认,并说明影响) */
export function confirmDelete(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    Taro.showModal({
      title,
      content,
      confirmText: '删除',
      cancelText: '取消',
      confirmColor: '#e74c3c',
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false)
    });
  });
}

/** 轻提示 */
export function toast(title: string, icon: 'success' | 'error' | 'none' = 'success') {
  Taro.showToast({ title, icon, duration: 1500 });
}

/**
 * 复制到剪贴板,**返回是否成功** —— 不抛异常。
 *
 * 为什么要一个返回值:手机剪贴板对超大文本会失败(备份几万字那一次),而失败时页面
 * 要做的事和成功完全不同(把全文摊在屏幕上让用户手动选)。吞掉异常只弹一句「失败」
 * 等于让用户对着一个选不中的页面干瞪眼。
 *
 * 全站写剪贴板都从这一个函数进(备份、训练文字、计划文字):哪天要换写法
 * (比如大文本分片),只改这里一处。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await Taro.setClipboardData({ data: text });
    return true;
  } catch {
    return false;
  }
}
