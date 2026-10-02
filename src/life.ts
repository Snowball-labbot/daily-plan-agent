import type { CategoryValue, LifeAreaValue } from './domain.ts'

export const LIFE_AREAS = [
  { key: 'work', label: '工作与学习', hint: '推进一件真正重要的事' },
  { key: 'health', label: '健康', hint: '训练、恢复和照顾身体' },
  { key: 'relationships', label: '人际关系', hint: '聚餐、联系朋友和家人' },
] as const

export function lifeAreaOf(item: { category: CategoryValue; lifeArea?: LifeAreaValue | undefined }): LifeAreaValue {
  return item.lifeArea ?? (item.category === 'gym' ? 'health' : ['study', 'intern'].includes(item.category) ? 'work' : 'life')
}
