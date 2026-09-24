// @muw-owned
// 人机校验（PoW）工作线程入口：逻辑都在 lib/activation-pow.ts 里（可在单测中直接跑纯函数），
// 这里只负责把作用域接起来。放 Worker 里是为了让 18 位难度那 0.4 秒的计算不冻结界面。
import { activationPowScope } from './lib/activation-pow'

activationPowScope()
