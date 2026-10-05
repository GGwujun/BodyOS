import { coachChat } from './prompts';
import type { ZhipuMessage } from './zhipu';

export async function completeCoachTurn(
  history: ZhipuMessage[], userContent: string, context: unknown,
  persist: (reply: string) => Promise<unknown>
) {
  const reply = await coachChat([...history, {role:'user',content:userContent}], context);
  await persist(reply);
  return reply;
}
