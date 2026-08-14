// 测试辅助：构造标准角色卡
import type { CharCardV2 } from '../src/shared/types'

export function makeTestCard(): CharCardV2 {
  return {
    spec: 'chara_card_v2',
    spec_version: '1.0',
    data: {
      name: '测试角色',
      description: '测试用',
      first_mes: '你好，我是测试角色。',
      alternate_greetings: [],
      character_book: { name: '测试', entries: [] },
      extensions: { regex_scripts: [], tavern_helper: { scripts: {}, variables: {} } }
    }
  }
}
