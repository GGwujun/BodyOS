/**
 * 小程序端**不能**把事件处理函数设成 `undefined`。
 *
 * ## 症状
 * 一个「点一下才有效果」的控件,最自然的写法是:
 *
 * ```tsx
 * <Text onClick={failed ? load : undefined}>读失败,点这里重试</Text>
 * ```
 *
 * 在 H5 上没问题,在小程序端**会抛异常**:
 *
 * ```
 * TypeError: Cannot read property '_num' of undefined
 *   at _TaroElement.removeEventListener
 *   at setEvent (react-dom)
 * ```
 *
 * Taro 3.6 的 `setEvent` 里,值不是函数时走这一支:
 *
 * ```js
 * } else {
 *   dom.removeEventListener(eventName, oldValue);   // 没传第三个参数
 * }
 * ```
 *
 * 没传第三个参数 = `sideEffect` 用默认的 `true`,于是 `TaroElement.removeEventListener`
 * 会去把节点降级成 `pure-text` / `static-text`,查表:
 *
 * ```js
 * const value = isHasExtractProp(this) ? `static-${name}` : `pure-${name}`;
 * const valueAlias = componentsAlias[value]._num;   // pure-text 不在表里
 * ```
 *
 * 而 `getComponentsAlias` 的补表里只有 `StaticView/StaticImage/StaticText/PureView/CatchView`
 * —— **没有 `PureText`**。所以只要在 `<Text>` 上把最后一个事件处理函数解绑,必崩。
 *
 * ## 后果比「这一下没反应」严重得多
 * 异常发生在 React 的 commit 阶段,被 Taro 的 error boundary 接住,**整棵子树就此废掉**:
 * 弹层还画在屏幕上,但里面每一个按钮、每一个输入框都不再响应 —— 用户看到的是
 * 「这个页面点了没反应」,而真正的原因在几百行之外的那一行三元表达式。
 *
 * ## 所以:事件永远绑着,条件写进函数体
 *
 * ```tsx
 * <Text onClick={() => { if (failed) load(); }}>读失败,点这里重试</Text>
 * ```
 *
 * 用 `onIf` 也行,它只是把那个 `if` 起了个名字,读起来更清楚:
 *
 * ```tsx
 * <Text onClick={onIf(failed, load)}>读失败,点这里重试</Text>
 * ```
 *
 * 另外两种同样会踩坑的写法(都别用):
 * - `onClick={cond && fn}` —— `cond` 为 false 时值就是 `false`,`isFunction(false)` 不成立;
 * - `onClick={cond ? fn : null}` / `: false` —— 同理,只要最终不是函数就走崩的那一支。
 *
 * 第三种不写出来就看不出来:**值是一个可能为 `undefined` 的裸标识符**。
 *
 * ```tsx
 * <Text onClick={maybeFn}>…</Text>      // maybeFn 可能是 undefined
 * <View onClick={props.onTap}>…</View>  // 同理
 * ```
 *
 * 它和上面两条是同一个机制(`isFunction(undefined)` 同样不成立),但静态扫不出来 ——
 * `onClick={handleSave}` 和 `onClick={maybeFn}` 长得一模一样,而前者完全正常。
 * `smoke-taro-events.mjs` 因此只查前两种:把裸标识符也禁掉会误伤一大片正常代码,
 * 而一个天天误报的检查等于没有。**这一条只能靠自觉:可选的事件处理器拿空函数兜底。**
 *
 * ```tsx
 * const noop = () => undefined;
 * <View onClick={onTap ?? noop}>…</View>
 * ```
 *
 * 换个函数反而是安全的:`setEvent` 在「旧值也是函数」时走的是 `sideEffect: false`
 * 那条路(每次渲染新建一个箭头函数不会有事)。**只有「函数 → 非函数」这一步会崩。**
 *
 * 静态扫描见 `scripts/smoke-taro-events.mjs`(它按语法扫全库,不靠自觉)。
 */

/**
 * 条件成立时才响应,否则点了什么也不做。
 *
 * 唯一的作用是**给那个条件起个名字**,让「事件必须永远绑着」这条规矩在调用处看得见
 * —— 直接写 `onClick={() => { if (cond) fn(); }}` 效果完全一样。
 */
export function onIf<E = unknown>(cond: boolean, fn: (e: E) => void): (e: E) => void {
  return (e: E) => { if (cond) fn(e); };
}
