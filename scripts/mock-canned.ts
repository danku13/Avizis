// Avizis — canned-ответы для нативных мок-провайдеров (CR-017).
// Тот же контракт выбора по system-промпту движка, что и mock-openai.ts
// (модуль планирования → план, супервайзер → no_changes, модуль принятия
// решений → выбор варианта, иначе — текст шага); NORMAL_PLAN идентичен,
// чтобы E2E-прогоны против нативных моков строили тот же граф.
export const EXPECTED_KEY = 'sk-test-native-key-777'

export const NORMAL_PLAN = {
  certainty: 0.5,
  nodes: [
    {
      id: 'n1',
      title: 'Сбор входных данных',
      description: 'Собирает и нормализует входные данные задачи для дальнейшего анализа.',
      dependsOn: [],
    },
    {
      id: 'dec1',
      title: 'Решение: стратегия анализа',
      description: 'Развилка выбора стратегии анализа: определяет дальнейшие шаги и итог.',
      dependsOn: ['n1'],
      decision: {
        question: 'Какую стратегию анализа данных применить?',
        domain: 'strategy',
        selection: 'single',
        certaintyAfter: 0.85,
        options: [
          {
            id: 'a',
            label: 'Быстрая статистическая проверка',
            rationale: 'Дёшево и быстро: проверка ключевых метрик без глубокой детализации.',
            steps: [
              { id: 'ba1', title: 'Проверка ключевых метрик', description: 'Расчёт и сверка ключевых метрик.' },
            ],
          },
          {
            id: 'b',
            label: 'Глубокое расследование',
            rationale: 'Дороже, но находит причины: два шага детального разбора.',
            steps: [
              { id: 'bb1', title: 'Корреляционный анализ', description: 'Поиск связей между показателями.' },
              { id: 'bb2', title: 'Поиск причин отклонений', description: 'Разбор корней обнаруженных аномалий.' },
            ],
          },
          {
            id: 'c',
            label: 'Запрос контекста у владельца',
            rationale: 'Уточнение бизнес-контекста до анализа.',
            steps: [
              { id: 'bc1', title: 'Опрос владельца данных', description: 'Сбор пояснений по данным.' },
            ],
          },
        ],
      },
    },
    {
      id: 'nfin',
      title: 'Формирование результата',
      description: 'Сводит итог анализа в финальный ответ.',
      dependsOn: ['ba1', 'bb2', 'bc1'],
    },
  ],
}

/** Выбор canned-ответа по system-промпту движка (контракт mock-openai.ts) */
export function pickResponse(system: string): string {
  const sys = system || ''
  if (sys.includes('модуль планирования')) return JSON.stringify(NORMAL_PLAN)
  if (sys.includes('супервайзер')) return JSON.stringify({ decision: 'no_changes', certainty: 0.6 })
  if (sys.includes('модуль принятия решений')) {
    return JSON.stringify({ optionId: 'a', reasoning: 'Мок-выбор: первый вариант' })
  }
  return 'Мок-результат шага: данные проверены, аномалий нет'
}

/** Часы usage для реалистичной provenance (детерминированные, как в mock-openai) */
export const MOCK_USAGE = { prompt: 90, completion: 30 }
