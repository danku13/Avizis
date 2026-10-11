// TACG — модалка настроек LLM (BYOK): пресеты провайдеров, baseUrl, модель,
// API-ключ с show/hide (маска-плейсхолдер = «не менять»), проверка подключения,
// per-role модели в расширенном режиме, сохранение с серверной валидацией.
'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronRight, Cpu, Eye, EyeOff, KeyRound, Loader2, Plug, Settings2, ShieldCheck } from 'lucide-react'
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
import { LlmConfigPublic, LlmRole } from '@/lib/tacg/types'
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

/** Черновик формы из публичного конфига: ключ всегда пустой (пусто = «не менять») */
function seedForm(cfg: LlmConfigPublic | null): FormState {
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
  }
}

export function SettingsModal() {
  const open = useTacgStore((s) => s.settingsOpen)
  const closeSettings = useTacgStore((s) => s.closeSettings)
  const llmConfig = useTacgStore((s) => s.llmConfig)
  const llmStatus = useTacgStore((s) => s.llmStatus)
  const llmSaving = useTacgStore((s) => s.llmSaving)
  const llmTesting = useTacgStore((s) => s.llmTesting)
  const setLlmSaving = useTacgStore((s) => s.setLlmSaving)
  const setLlmTesting = useTacgStore((s) => s.setLlmTesting)
  const setLlmStatus = useTacgStore((s) => s.setLlmStatus)

  const [form, setForm] = useState<FormState | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [rolesOpen, setRolesOpen] = useState(false)
  const [seen, setSeen] = useState<{ open: boolean; cfg: LlmConfigPublic | null } | undefined>(undefined)

  // Сброс черновика при открытии модалки или обновлении конфига — паттерн
  // «Adjusting state when a prop changes» из документации React (без эффектов)
  if (seen === undefined || seen.open !== open || seen.cfg !== llmConfig) {
    setSeen({ open, cfg: llmConfig })
    setForm(null)
    setShowKey(false)
  }

  const values: FormState = form ?? seedForm(llmConfig)
  const setField = <K extends keyof FormState>(key: K, v: FormState[K]) => setForm({ ...values, [key]: v })

  const { preset, baseUrl, model, apiKey, roleModels } = values

  const isZai = preset === 'zai'
  const presetMeta = PRESETS.find((p) => p.id === preset)!
  const keyMask = llmConfig?.default?.apiKey

  // при открытии — запросить актуальный конфиг с сервера (только маска ключа)
  useEffect(() => {
    if (open) getSocket().emit('llm:config:get')
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
    return config
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
        className="flex max-h-[86dvh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden border-zinc-800 bg-zinc-950/95 p-0 backdrop-blur-md sm:max-w-none sm:w-[55vw] lg:w-[58vw] xl:w-[64vw]"
      >
        <DialogDescription className="sr-only">
          Настройки LLM-провайдеров (BYOK): пресет, адрес, модель, ключ с маской, проверка подключения и модели по ролям
        </DialogDescription>

        {/* ─── Шапка ─── */}
        <DialogHeader className="border-b border-zinc-800/80 px-6 py-4 text-left">
          <DialogTitle className="flex items-center gap-2.5 text-lg font-semibold leading-tight">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
              <Settings2 className="size-4.5" />
            </span>
            Настройки LLM · BYOK
          </DialogTitle>
          <p className="mt-1.5 max-w-2xl text-sm text-zinc-400">
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
            <div className="flex items-start gap-2.5 rounded-lg border border-teal-500/30 bg-teal-500/10 p-3.5 text-xs leading-relaxed text-teal-100">
              <Cpu className="mt-0.5 size-4 shrink-0" />
              <span>
                z-ai SDK — встроенный провайдер стенда: работает без конфигурации и ключей. Выберите другой пресет, чтобы
                подключить свою модель (OpenAI, DeepSeek, OpenRouter, локальный Ollama или любой OpenAI-compatible
                эндпоинт).
              </span>
            </div>
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
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-zinc-500 transition-colors hover:text-zinc-300"
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
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-red-500/40 bg-red-500/10 text-red-300'
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
          <Collapsible open={rolesOpen} onOpenChange={setRolesOpen} className="rounded-lg border border-zinc-800">
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-900/60">
              <ChevronRight className={cn('size-4 shrink-0 text-zinc-500 transition-transform', rolesOpen && 'rotate-90')} />
              Роли: своя модель на каждую точку вызова
              <span className="ml-auto text-xs font-normal text-zinc-500">пусто = наследовать дефолт</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 border-t border-zinc-800 px-3.5 py-3">
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
        </div>

        {/* ─── Подвал ─── */}
        <DialogFooter className="flex-row flex-wrap items-center gap-3 border-t border-zinc-800/80 px-6 py-3.5">
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
