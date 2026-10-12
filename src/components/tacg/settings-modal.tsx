// TACG — модалка настроек LLM (BYOK): пресеты провайдеров, baseUrl, модель,
// API-ключ с show/hide (маска-плейсхолдер = «не менять»), проверка подключения,
// per-role модели в расширенном режиме, сохранение с серверной валидацией.
'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Banknote, ChevronRight, Cpu, DollarSign, Eye, EyeOff, KeyRound, Loader2, Plug, RefreshCw, Settings2, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CURRENCY_SYMBOLS, LlmConfigPublic, LlmRole } from '@/lib/tacg/types'
import { getSocket } from '@/lib/tacg/socket'
import { useTacgStore } from '@/store/tacg-store'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type PresetId = 'zai' | 'openai' | 'deepseek' | 'openrouter' | 'ollama' | 'custom'

interface FormState {
  preset: PresetId
  baseUrl: string
  model: string
  apiKey: string
  roleModels: Record<LlmRole, string>
  /** Ручная цена текущей модели, USD за 1M токенов (пусто = каталог/нет цены) */
  priceIn: string
  priceOut: string
  /** Ручной курс выбранной валюты (единиц за 1 USD; пусто = сетевой курс) */
  currencyRate: string
}

const PRESETS: { id: PresetId; label: string; baseUrl: string; modelHint: string }[] = [
  { id: 'zai', label: 'Дефолт: z-ai SDK', baseUrl: '', modelHint: '' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelHint: 'gpt-4o-mini' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', modelHint: 'deepseek-chat' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modelHint: 'deepseek/deepseek-chat' },
  { id: 'ollama', label: 'Ollama (локально)', baseUrl: 'http://localhost:11434/v1', modelHint: 'llama3.1' },
  { id: 'custom', label: 'Свой OpenAI-compatible', baseUrl: '', modelHint: 'модель провайдера' },
]

const ROLES: { role: LlmRole; label: string; hint: string }[] = [
  { role: 'planner', label: 'Планировщик', hint: 'строит граф задачи' },
  { role: 'executor', label: 'Исполнитель', hint: 'выполняет шаги графа' },
  { role: 'supervisor', label: 'Супервайзер', hint: 'адаптирует план по ходу' },
  { role: 'decider', label: 'Решатель', hint: 'выбирает варианты на развилках' },
]

function detectPreset(cfg: LlmConfigPublic | null): PresetId {
  const d = cfg?.default
  if (!d || d.adapter === 'zai') return 'zai'
  const url = d.baseUrl || ''
  const hit = PRESETS.find((p) => p.id !== 'zai' && p.id !== 'custom' && p.baseUrl === url)
  return hit?.id ?? 'custom'
}

/** Ключ прайса для текущей модели: zai → 'z-ai-sdk', иначе нормализованный id модели */
function pricingKey(cfg: LlmConfigPublic | null): string {
  const d = cfg?.default
  if (!d || d.adapter === 'zai') return 'z-ai-sdk'
  return (d.model || '').trim().toLowerCase() || 'z-ai-sdk'
}

/** Черновик формы из публичного конфига: ключ всегда пустой (пусто = «не менять») */
function seedForm(cfg: LlmConfigPublic | null, displayCurrency: string): FormState {
  const price = cfg?.pricing?.models?.[pricingKey(cfg)]
  const rate = cfg?.currency?.rates?.[displayCurrency]
  return {
    preset: detectPreset(cfg),
    baseUrl: cfg?.default?.baseUrl || '',
    model: cfg?.default?.model || '',
    apiKey: '',
    roleModels: {
      planner: cfg?.roles?.planner?.model || '',
      executor: cfg?.roles?.executor?.model || '',
      supervisor: cfg?.roles?.supervisor?.model || '',
      decider: cfg?.roles?.decider?.model || '',
    },
    priceIn: typeof price?.inputPer1M === 'number' ? String(price.inputPer1M) : '',
    priceOut: typeof price?.outputPer1M === 'number' ? String(price.outputPer1M) : '',
    currencyRate: typeof rate === 'number' ? String(rate) : '',
  }
}

/** Поля ручной цены модели (ADR-016): USD за 1M токенов вход/выход; пусто = каталог/нет цены */
function PriceFields({
  label,
  priceIn,
  priceOut,
  onChange,
  hint,
}: {
  label: string
  priceIn: string
  priceOut: string
  onChange: (key: 'priceIn' | 'priceOut', v: string) => void
  hint: string
}) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-xs">
        <DollarSign className="size-3.5 text-teal-500/80" />
        {label}
      </Label>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="llm-price-in" className="text-[11px] font-normal text-zinc-500">Вход (промпт)</Label>
          <Input
            id="llm-price-in"
            value={priceIn}
            onChange={(e) => onChange('priceIn', e.target.value)}
            placeholder="из каталога"
            inputMode="decimal"
            className="font-mono text-xs tabular-nums"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="llm-price-out" className="text-[11px] font-normal text-zinc-500">Выход (ответ)</Label>
          <Input
            id="llm-price-out"
            value={priceOut}
            onChange={(e) => onChange('priceOut', e.target.value)}
            placeholder="из каталога"
            inputMode="decimal"
            className="font-mono text-xs tabular-nums"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">{hint}</p>
    </div>
  )
}

export function SettingsModal() {
  const open = useTacgStore((s) => s.settingsOpen)
  const closeSettings = useTacgStore((s) => s.closeSettings)
  const llmConfig = useTacgStore((s) => s.llmConfig)
  const llmStatus = useTacgStore((s) => s.llmStatus)
  const llmSaving = useTacgStore((s) => s.llmSaving)
  const llmTesting = useTacgStore((s) => s.llmTesting)
  const pricingStatus = useTacgStore((s) => s.pricingStatus)
  const currencyStatus = useTacgStore((s) => s.currencyStatus)
  const displayCurrency = useTacgStore((s) => s.displayCurrency)
  const setDisplayCurrency = useTacgStore((s) => s.setDisplayCurrency)
  const setLlmSaving = useTacgStore((s) => s.setLlmSaving)
  const setLlmTesting = useTacgStore((s) => s.setLlmTesting)
  const setLlmStatus = useTacgStore((s) => s.setLlmStatus)

  const [form, setForm] = useState<FormState | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [rolesOpen, setRolesOpen] = useState(false)
  const [pricingRefreshing, setPricingRefreshing] = useState(false)
  const [currencyRefreshing, setCurrencyRefreshing] = useState(false)
  const [seen, setSeen] = useState<{ open: boolean; cfg: LlmConfigPublic | null; cur: string } | undefined>(undefined)

  // Сброс черновика при открытии модалки или обновлении конфига/валюты — паттерн
  // «Adjusting state when a prop changes» из документации React (без эффектов)
  if (seen === undefined || seen.open !== open || seen.cfg !== llmConfig || seen.cur !== displayCurrency) {
    setSeen({ open, cfg: llmConfig, cur: displayCurrency })
    setForm(null)
    setShowKey(false)
  }

  const values: FormState = form ?? seedForm(llmConfig, displayCurrency)
  const setField = <K extends keyof FormState>(key: K, v: FormState[K]) => setForm({ ...values, [key]: v })

  const { preset, baseUrl, model, apiKey, roleModels, priceIn, priceOut, currencyRate } = values

  const isZai = preset === 'zai'
  const presetMeta = PRESETS.find((p) => p.id === preset)!
  const keyMask = llmConfig?.default?.apiKey

  // при открытии — запросить актуальный конфиг, статус прайсов и курсов с сервера
  useEffect(() => {
    if (open) {
      getSocket().emit('llm:config:get')
      getSocket().emit('pricing:get')
      getSocket().emit('currency:get')
    }
  }, [open])

  const applyPreset = (id: PresetId) => {
    const nextBaseUrl = id === 'custom' ? '' : PRESETS.find((x) => x.id === id)!.baseUrl
    setForm({ ...values, preset: id, baseUrl: nextBaseUrl })
  }

  const buildPayload = () => {
    const config: any = { default: { adapter: isZai ? 'zai' : 'openai-compatible' } }
    if (!isZai) {
      config.default.baseUrl = baseUrl.trim()
      config.default.model = model.trim()
      if (apiKey.trim()) config.default.apiKey = apiKey.trim()
    }
    const roles: any = {}
    for (const { role } of ROLES) {
      const m = roleModels[role].trim()
      if (m) roles[role] = { model: m }
    }
    if (Object.keys(roles).length) config.roles = roles
    // ручная цена текущей модели (ADR-016): USD за 1M токенов, приоритет выше каталогов
    const inPrice = parseFloat(priceIn.replace(',', '.'))
    const outPrice = parseFloat(priceOut.replace(',', '.'))
    const key = isZai ? 'z-ai-sdk' : model.trim().toLowerCase()
    if (key && ((Number.isFinite(inPrice) && inPrice > 0) || (Number.isFinite(outPrice) && outPrice > 0))) {
      config.pricing = {
        models: {
          [key]: {
            ...(Number.isFinite(inPrice) && inPrice > 0 ? { inputPer1M: inPrice } : {}),
            ...(Number.isFinite(outPrice) && outPrice > 0 ? { outputPer1M: outPrice } : {}),
          },
        },
      }
    }
    // ручной курс выбранной валюты (ADR-019): единиц за 1 USD, приоритет выше ЦБ/er-api
    const rate = parseFloat(currencyRate.replace(',', '.'))
    if (displayCurrency !== 'USD' && Number.isFinite(rate) && rate > 0) {
      config.currency = { rates: { [displayCurrency]: rate } }
    }
    return config
  }

  const refreshPricing = () => {
    if (pricingRefreshing) return
    setPricingRefreshing(true)
    const s = getSocket()
    const done = () => {
      s.off('pricing:refresh:result', done)
      setPricingRefreshing(false)
    }
    s.once('pricing:refresh:result', done)
    // страховка от потерянного ответа — снимаем спиннер через 20 с
    setTimeout(done, 20_000)
    s.emit('pricing:refresh')
  }

  const refreshCurrency = () => {
    if (currencyRefreshing) return
    setCurrencyRefreshing(true)
    const s = getSocket()
    const done = () => {
      s.off('currency:refresh:result', done)
      setCurrencyRefreshing(false)
    }
    s.once('currency:refresh:result', done)
    setTimeout(done, 20_000)
    s.emit('currency:refresh')
  }

  const testConnection = () => {
    if (isZai) return
    setLlmTesting(true)
    setLlmStatus(null)
    getSocket().emit('llm:config:test', { config: buildPayload() })
  }

  const save = () => {
    if (!isZai && (!baseUrl.trim() || !model.trim())) {
      toast.error('Укажите baseUrl и модель провайдера')
      return
    }
    setLlmSaving(true)
    setLlmStatus(null)
    getSocket().emit('llm:config:save', { config: buildPayload() })
  }

  const close = (o: boolean) => {
    if (!o) closeSettings()
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="flex max-h-[86dvh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/95 p-0 backdrop-blur-md sm:max-w-none sm:w-[55vw] lg:w-[58vw] xl:w-[64vw]"
      >
        <DialogDescription className="sr-only">
          Настройки LLM-провайдеров (BYOK): пресет, адрес, модель, ключ с маской, проверка подключения и модели по ролям
        </DialogDescription>

        {/* ─── Шапка ─── */}
        <DialogHeader className="border-b border-zinc-200/80 dark:border-zinc-800/80 px-6 py-4 text-left">
          <DialogTitle className="flex items-center gap-2.5 text-lg font-semibold leading-tight">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-300">
              <Settings2 className="size-4.5" />
            </span>
            Настройки LLM · BYOK
          </DialogTitle>
          <p className="mt-1.5 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Свои модели и ключи для агента: планировщика, исполнителя, супервайзера и решателя. Ключ хранится только на
            сервере и отображается маской.
          </p>
        </DialogHeader>

        {/* ─── Тело ─── */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="space-y-2">
            <Label htmlFor="llm-preset">Провайдер</Label>
            <Select value={preset} onValueChange={(v) => applyPreset(v as PresetId)}>
              <SelectTrigger id="llm-preset" aria-label="Провайдер LLM" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isZai ? (
            <>
            <div className="flex items-start gap-2.5 rounded-lg border border-teal-500/30 bg-teal-500/10 p-3.5 text-xs leading-relaxed text-teal-900 dark:text-teal-100">
              <Cpu className="mt-0.5 size-4 shrink-0" />
              <span>
                z-ai SDK — встроенный провайдер стенда: работает без конфигурации и ключей. Выберите другой пресет, чтобы
                подключить свою модель (OpenAI, DeepSeek, OpenRouter, локальный Ollama или любой OpenAI-compatible
                эндпоинт).
              </span>
            </div>
            {/* Цена z-ai SDK (ADR-016): у встроенного провайдера нет публичного прайса — можно задать вручную */}
            <PriceFields
              label="Цена z-ai SDK за 1M токенов, $"
              priceIn={priceIn}
              priceOut={priceOut}
              onChange={(k, v) => setField(k, v)}
              hint="У встроенного провайдера нет публичного прайса — задайте свою цену, чтобы видеть стоимость прогонов"
            />
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="llm-baseurl">Base URL</Label>
                <Input
                  id="llm-baseurl"
                  value={baseUrl}
                  onChange={(e) => setField('baseUrl', e.target.value)}
                  placeholder="https://api.provider.com/v1"
                  className="font-mono text-xs"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-[11px] text-zinc-500">
                  Запросы идут в <span className="font-mono">{'{baseUrl}/chat/completions'}</span> от имени движка
                  агента.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="llm-model">Модель</Label>
                <Input
                  id="llm-model"
                  value={model}
                  onChange={(e) => setField('model', e.target.value)}
                  placeholder={presetMeta.modelHint}
                  className="font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              {/* Ручная цена модели (ADR-016): USD за 1M токенов; пусто — прайс из каталогов */}
              <PriceFields
                label="Цена модели за 1M токенов, $"
                priceIn={priceIn}
                priceOut={priceOut}
                onChange={(k, v) => setField(k, v)}
                hint="Пусто — цена подтягивается с OpenRouter / из каталога LiteLLM; вручную — приоритет выше (z-ai, Ollama, свой тариф)"
              />

              <div className="space-y-2">
                <Label htmlFor="llm-key" className="flex items-center gap-1.5">
                  <KeyRound className="size-3.5" />
                  API-ключ
                </Label>
                <div className="relative">
                  <Input
                    id="llm-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setField('apiKey', e.target.value)}
                    placeholder={keyMask ? `${keyMask} — пусто = не менять` : 'Ключ API (Bearer)'}
                    className="pr-10 font-mono text-xs"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? 'Скрыть ключ' : 'Показать ключ'}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-zinc-500 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <ShieldCheck className="size-3.5 shrink-0 text-emerald-500/70" />
                  Хранится на сервере (файл с правами 600), в прогоны и отчёты не попадает.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <Button variant="outline" size="sm" onClick={testConnection} disabled={llmTesting} className="gap-1.5">
                  {llmTesting ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
                  {llmTesting ? 'Проверяю…' : 'Проверить подключение'}
                </Button>
                {llmStatus && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'max-w-full break-words gap-1.5 normal-case',
                      llmStatus.ok
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                    )}
                  >
                    {llmStatus.ok ? <Plug className="size-3" /> : <AlertTriangle className="size-3" />}
                    {llmStatus.ok
                      ? `подключение работает · ${llmStatus.latencyMs ?? '—'} мс`
                      : llmStatus.error || 'ошибка проверки'}
                  </Badge>
                )}
              </div>
            </>
          )}

          {/* ─── Расширенный режим: per-role модели ─── */}
          <Collapsible open={rolesOpen} onOpenChange={setRolesOpen} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900/60">
              <ChevronRight className={cn('size-4 shrink-0 text-zinc-500 transition-transform', rolesOpen && 'rotate-90')} />
              Роли: своя модель на каждую точку вызова
              <span className="ml-auto text-xs font-normal text-zinc-500">пусто = наследовать дефолт</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 px-3.5 py-3">
              {ROLES.map(({ role, label, hint }) => (
                <div key={role} className="space-y-1.5">
                  <Label htmlFor={`llm-role-${role}`} className="flex items-baseline gap-2">
                    {label}
                    <span className="text-[11px] font-normal text-zinc-500">{hint}</span>
                  </Label>
                  <Input
                    id={`llm-role-${role}`}
                    value={roleModels[role]}
                    onChange={(e) => setField('roleModels', { ...roleModels, [role]: e.target.value })}
                    placeholder={isZai ? 'наследует z-ai SDK' : model.trim() || presetMeta.modelHint}
                    className="font-mono text-xs"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>

          {/* ─── Прайсинг моделей (ADR-016): источники динамических цен ─── */}
          <div className="space-y-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <DollarSign className="size-4 shrink-0 text-teal-500 dark:text-teal-400" />
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Прайсинг моделей (динамический)</span>
              <Button
                variant="outline"
                size="sm"
                onClick={refreshPricing}
                disabled={pricingRefreshing || pricingStatus?.disabled}
                className="ml-auto h-7 gap-1.5"
              >
                {pricingRefreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {pricingRefreshing ? 'Обновляю…' : 'Обновить прайсы'}
              </Button>
            </div>
            {pricingStatus?.disabled ? (
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Сетевые источники выключены (TACG_PRICING_DISABLED=1) — стоимость считается только по ценам, заданным
                вручную.
              </p>
            ) : (
              <div className="space-y-1">
                {(pricingStatus?.sources ?? []).map((s) => (
                  <div key={s.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs tabular-nums">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1',
                        s.ok === false ? 'text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'
                      )}
                    >
                      {s.ok === false && <AlertTriangle className="size-3 shrink-0" />}
                      {s.label}:
                    </span>
                    <span className="text-zinc-500">
                      {s.models} моделей
                      {s.fetchedAt ? ` · обновлён ${new Date(s.fetchedAt).toLocaleString('ru-RU')}` : ''}
                      {s.ok === false ? ` · ${s.error ?? 'недоступен'}` : ''}
                    </span>
                  </div>
                ))}
                <p className="pt-0.5 text-[11px] leading-relaxed text-zinc-500">
                  Цены подтягиваются с провайдеров в рантайме (не захардкожены), кэшируются на диске, обновление — при
                  старте и раз в {pricingStatus?.ttlHours ?? 24} ч. Стоимость в тулбаре, инспекторе и отчётах — оценка
                  (≈) по этим ценам.
                </p>
              </div>
            )}
          </div>

          {/* ─── Конвертация валюты (ADR-019, FR-910): валюта отображения, источники курсов ─── */}
          <div className="space-y-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Banknote className="size-4 shrink-0 text-teal-500 dark:text-teal-400" />
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Валюта стоимости</span>
              <Select value={displayCurrency} onValueChange={(v) => setDisplayCurrency(v)}>
                <SelectTrigger aria-label="Валюта отображения стоимости" className="ml-auto h-8 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(currencyStatus?.entries ?? [{ code: 'USD', rate: 1, source: 'manual' }]).map((e) => (
                    <SelectItem key={e.code} value={e.code} disabled={e.code !== 'USD' && !(e.rate > 0)}>
                      {CURRENCY_SYMBOLS[e.code] ?? e.code} · {e.code}
                      {e.rate > 0 ? '' : ' — нет курса'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={refreshCurrency}
                disabled={currencyRefreshing || currencyStatus?.disabled}
                className="h-7 gap-1.5"
              >
                {currencyRefreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {currencyRefreshing ? 'Обновляю…' : 'Курсы'}
              </Button>
            </div>
            {displayCurrency !== 'USD' && (
              <div className="space-y-1.5">
                <Label htmlFor="llm-currency-rate" className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  Ручной курс: {CURRENCY_SYMBOLS[displayCurrency] ?? displayCurrency} за 1 $
                  <span className="font-normal text-zinc-500">пусто — курс из источников ниже</span>
                </Label>
                <Input
                  id="llm-currency-rate"
                  value={currencyRate}
                  onChange={(e) => setField('currencyRate', e.target.value)}
                  placeholder={
                    currencyStatus?.entries.find((e) => e.code === displayCurrency && e.rate > 0)
                      ? String(currencyStatus.entries.find((e) => e.code === displayCurrency)!.rate)
                      : 'курса нет'
                  }
                  inputMode="decimal"
                  className="font-mono text-xs tabular-nums"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}
            {currencyStatus?.disabled ? (
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Сетевые источники курсов выключены (TACG_CURRENCY_DISABLED=1) — конвертация только по ручному курсу.
              </p>
            ) : (
              <div className="space-y-1">
                {(currencyStatus?.sources ?? []).map((s) => (
                  <div key={s.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs tabular-nums">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1',
                        s.ok === false ? 'text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'
                      )}
                    >
                      {s.ok === false && <AlertTriangle className="size-3 shrink-0" />}
                      {s.label}:
                    </span>
                    <span className="text-zinc-500">
                      {s.currencies ?? 0} валют
                      {s.asOf ? ` · котировка ${s.asOf}` : ''}
                      {s.fetchedAt ? ` · обновлён ${new Date(s.fetchedAt).toLocaleString('ru-RU')}` : ''}
                      {s.ok === false ? ` · ${s.error ?? 'недоступен'}` : ''}
                    </span>
                  </div>
                ))}
                <p className="pt-0.5 text-[11px] leading-relaxed text-zinc-500">
                  Курсы подтягиваются в рантайме (приоритет: ручной → ЦБ РФ → зеркало ЦБ → open.er-api), кэшируются на
                  диске, обновление — при старте и раз в {currencyStatus?.ttlHours ?? 6} ч. Базис аудита — USD;
                  конвертация только на отображение (чип, инспектор, MD-отчёт).
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ─── Подвал ─── */}
        <DialogFooter className="flex-row flex-wrap items-center gap-3 border-t border-zinc-200 dark:border-zinc-800/80 px-6 py-3.5">
          <p className="mr-auto hidden text-[11px] text-zinc-500 sm:block">
            Сохранение сопровождается пробным запросом — неверный ключ или адрес не сохранятся.
          </p>
          <Button size="sm" onClick={save} disabled={llmSaving} className="gap-1.5">
            {llmSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Settings2 className="size-3.5" />}
            {llmSaving ? 'Сохраняю…' : 'Сохранить'}
          </Button>
          <Button size="sm" variant="ghost" onClick={closeSettings}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
