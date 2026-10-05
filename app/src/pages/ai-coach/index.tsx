import { useState, useEffect } from 'react';
import { View, Text, Input, Button, ScrollView } from '@tarojs/components';
import Screen from '@/components/Screen';
import { aiApi } from '@/services';
import type { ChatMessage } from '@/services/types';
import Taro from '@tarojs/taro';
import { ArrowLeft, ArrowRight, Audio } from '@taroify/icons';
import './index.scss';

/** 07 AI Coach — 对话 + 快捷问题 + 用户上下文 + 数据引用 */
const QUICK = ['我今天吃得怎么样?', '为什么体重不降?', '晚餐推荐', '帮我制定下周计划'];

export default function AICoach() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: '你好,我是你的 AI 教练。需要我帮你分析今日数据吗?' }
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // 进入页预加载历史对话
  useEffect(() => {
    aiApi
      .listHistory(20)
      .then((rows) => {
        if (rows.length > 0) {
          setMessages(rows.map((r) => ({ role: r.role, content: r.content })));
        }
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending) return;

    const nextMessages = [...messages, { role: 'user' as const, content }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    try {
      const r = await aiApi.chat({ messages: nextMessages });
      setMessages((m) => [...m, { role: 'assistant', content: r.reply }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `出错了:${(e as { message?: string })?.message || '请稍后重试'}` }
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen className="ai-coach-page">
      <View className="coach-nav"><ArrowLeft onClick={() => Taro.navigateBack()} /><Text>AI 教练</Text><ArrowRight /></View>
      <View className="coach-intro"><View className="bot-face">OS</View><View><Text>Hi，我是你的 AI 教练 👋</Text><Text>有什么可以帮助你？</Text></View></View>

      <ScrollView scrollY className="chat-scroll">
        {!loaded && (
          <View className="bubble ai">
            <Text className="fs-caption text-secondary">加载历史对话…</Text>
          </View>
        )}
        {messages.map((m, i) => (
          <View key={i} className={`bubble ${m.role}`}>
            <Text className="fs-caption">{m.content}</Text>
          </View>
        ))}
        {sending && (
          <View className="bubble ai">
            <Text className="fs-caption text-secondary">思考中…</Text>
          </View>
        )}
      </ScrollView>

      <View className="quick-row">
        {QUICK.map((q) => (
          <Text key={q} className="quick-chip" onClick={() => send(q)}>
            {q}
          </Text>
        ))}
      </View>

      <View className="chat-input-row">
        <Input
          className="chat-input"
          placeholder="问点什么…"
          value={input}
          onInput={(e) => setInput(e.detail.value)}
          onConfirm={() => send(input)}
        />
        <Button
          className="btn btn--primary"
          size="mini"
          loading={sending}
          onClick={() => send(input)}
        >
          <Audio />
        </Button>
      </View>
    </Screen>
  );
}
