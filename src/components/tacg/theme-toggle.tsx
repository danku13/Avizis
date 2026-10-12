// TACG — переключатель темы: тёмная (дефолт) / светлая, выбор в localStorage
'use client'

import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toggleTheme, useIsDark } from '@/lib/tacg/theme'

export function ThemeToggle() {
  const isDark = useIsDark()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          onClick={toggleTheme}
          aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
          title={isDark ? 'Светлая тема' : 'Тёмная тема'}
        >
          {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isDark ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
      </TooltipContent>
    </Tooltip>
  )
}
