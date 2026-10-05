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
