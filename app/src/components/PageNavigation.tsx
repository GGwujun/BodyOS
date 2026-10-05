import { View, Text, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { HomeOutlined, RecordsOutlined, Plus, BarChartOutlined, UserOutlined } from '@taroify/icons';
import { RoutePath, TAB_PAGES } from '@/constants/routes';
import './PageNavigation.scss';

/** Secondary screens share the design's persistent navigation; root tabs remain native. */
export default function PageNavigation({page}: {page: string}) {
  const current = `pages/${page.replace(/-page$/, '')}/index`;
  if (TAB_PAGES.includes(current as RoutePath) || current === 'pages/onboarding/index') return null;
  const active = current === RoutePath.WeeklyReport ? RoutePath.Trends
    : current === RoutePath.Food || current === RoutePath.Exercise ? RoutePath.Record
    : current === RoutePath.DataSources ? RoutePath.Profile : null;
  const items = [
    {path:RoutePath.Home,label:'首页',Icon:HomeOutlined},
    {path:RoutePath.Record,label:'记录',Icon:RecordsOutlined},
    {path:RoutePath.Record,label:'添加记录',Icon:Plus,add:true},
    {path:RoutePath.Trends,label:'趋势',Icon:BarChartOutlined},
    {path:RoutePath.Profile,label:'我的',Icon:UserOutlined}
  ];
  return <View className="page-navigation" role="navigation" aria-label="底部导航">
    {items.map(({path:target,label,Icon,add}) => <Button key={label}
      className={`page-navigation__item${active === target && !add ? ' is-active' : ''}${add ? ' is-add' : ''}`}
      aria-label={label}
      {...{role:'button'}}
      onClick={() => Taro.switchTab({url:`/${target}`}).catch(() => Taro.showToast({title:'页面切换失败，请重试',icon:'none'}))}>
      <Icon />{!add && <Text className="page-navigation__label">{label}</Text>}
    </Button>)}
  </View>;
}
