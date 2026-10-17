// ============================================================
// BF公式转文本 字段捷径 v1（纯本地计算，无服务器、无鉴权、无网络请求）
//
// 背景：飞书多维表格「公式字段」无法手动编辑、且字段捷径不能引用公式字段
//       （打包 CLI supportType 白名单不含 Formula/Lookup）。
// 方案：用本捷径做「可编辑的公式」——
//       ① 大输入框（textarea）写模板/指令，用 {1}{2}...{n} 引用下方批量选择的字段；
//       ② 不填模板时，按所选字段顺序用分隔符直接拼接；
//       ③ 输出 Text 字段，随时改模板重算，比飞书公式灵活。
// 支持引用的字段类型（CLI 白名单内）：文本/数字/单选/多选/日期/复选框/超链接/附件。
// ============================================================
import { basekit, field, FieldType, FieldComponent, FieldCode } from '@lark-opdev/block-basekit-server-api';

const { t } = field;

// 纯本地计算，无任何网络请求
basekit.addDomainList([]);

basekit.addField({
  i18n: {
    messages: {
      'zh-CN': {
        fieldName: 'BF公式转文本',
        template: '模板（可用 {1}{2}… 引用下方第N个字段）',
        refFields: '引用字段（批量，顺序对应 {1}{2}…）',
        separator: '分隔符（模板为空时按顺序拼接）',
      },
    },
  },
  formItems: [
    {
      key: 'template',
      label: t('template'),
      component: FieldComponent.Input,
      props: {
        mode: 'textarea',
        placeholder: '示例：【{1}】{2} 材质{3} 价格{4}元 —— 用 {数字} 占位引用字段；留空则直接按顺序拼接所有字段',
      },
      validator: { required: false },
    },
    {
      key: 'refFields',
      label: t('refFields'),
      component: FieldComponent.FieldSelect,
      props: {
        mode: 'multiple',
        supportType: [
          FieldType.Text,
          FieldType.Number,
          FieldType.SingleSelect,
          FieldType.MultiSelect,
          FieldType.DateTime,
          FieldType.Checkbox,
          FieldType.Url,
          FieldType.Attachment,
        ],
        placeholder: '按顺序选择要合并的字段（第一个={1}，第二个={2}…）',
      },
      validator: { required: false },
    },
    {
      key: 'separator',
      label: t('separator'),
      component: FieldComponent.Input,
      props: { placeholder: '默认空格；需要换行请填 \\n' },
      validator: { required: false },
    },
  ],
  resultType: {
    type: FieldType.Text,
  },
  execute: async (formItemParams: { [key: string]: any }, context: any) => {
    const log = (title: string, data?: any) => {
      console.log(JSON.stringify({ title, data, logID: context.logID, timestamp: Date.now() }));
    };
    log('===== BF公式转文本 v1 开始 =====');
    try {
      const { template, refFields, separator } = formItemParams;

      // FieldSelect(multiple) → 各字段值数组（顺序 = 面板选择顺序）
      const fieldsArr = refFields ? (Array.isArray(refFields) ? refFields : [refFields]) : [];
      const values = fieldsArr.map((v) => toText(v));

      const tpl = String(template || '').trim();
      let result: string;
      if (tpl) {
        // 模板模式：{1}..{n} 替换为对应字段值；越界占位符原样保留便于发现笔误
        result = tpl.replace(/\{(\d+)\}/g, (m: string, n: string) => {
          const idx = Number(n) - 1;
          return idx >= 0 && idx < values.length ? values[idx] : m;
        });
      } else {
        // 拼接模式：分隔符（默认空格，支持字面量 \n 转真换行）
        const sep = separator === undefined || separator === null || String(separator) === ''
          ? ' '
          : String(separator).replace(/\\n/g, '\n');
        result = values.join(sep);
      }
      log('完成', { fieldCount: values.length, mode: tpl ? 'template' : 'join', len: result.length });
      return { code: FieldCode.Success, data: result };
    } catch (error) {
      log('处理异常', String(error));
      return { code: FieldCode.Success, data: `[异常: ${String(error).substring(0, 100)}]` };
    }
  },
});

// ===== 通用字段值 → 文本（覆盖白名单 8 类字段的各种取值形态）=====
function toText(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return fmtNumber(v);
  if (Array.isArray(v)) {
    // 多选/人员/附件/富文本段：逐项提取后逗号连接
    return v.map((x) => toText(x)).filter((s) => s !== '').join(',');
  }
  if (typeof v === 'object') {
    // 超链接：{ link, text } —— 优先链接本身（必须在 text 判断之前，URL 对象也带 text 属性）
    if (typeof v.link === 'string') return v.link || toText(v.text);
    // 富文本段 / 单选：{ text }
    if (typeof v.text === 'string' || typeof v.text === 'number') return String(v.text);
    // 附件：{ name, attachmentToken, ... }
    if (typeof v.name === 'string') return v.name;
    // 通用 value 包装
    if (v.value !== undefined) return toText(v.value);
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }
  return String(v);
}

// 数字：DateTime 字段值也是毫秒时间戳，与数字字段无法从值层区分。
// 启发式：落在 2001~2096 年毫秒区间 → 按 UTC+8 格式化为日期；否则原样输出。
function fmtNumber(n: number): string {
  if (Number.isInteger(n) && n >= 1e12 && n <= 4e12) {
    return fmtDate(n);
  }
  return String(n);
}

function fmtDate(ts: number): string {
  const d = new Date(ts + 8 * 3600 * 1000); // UTC+8
  const p = (x: number) => String(x).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const hh = d.getUTCHours(), mm = d.getUTCMinutes();
  return hh === 0 && mm === 0 ? date : `${date} ${p(hh)}:${p(mm)}`;
}

export default basekit;
