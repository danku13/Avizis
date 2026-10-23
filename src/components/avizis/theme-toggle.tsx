// Avizis — переключатель темы: тёмная (дефолт) / светлая, выбор в localStorage
'use client'

import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toggleTheme, useIsDark } from '@/lib/avizis/theme'
import { useT } from '@/lib/avizis/i18n'

export function ThemeToggle() {
  const isDark = useIsDark()
  const t = useT()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          onClick={toggleTheme}
          aria-label={isDark ? t('theme.lightAria') : t('theme.darkAria')}
          title={isDark ? t('theme.lightTitle') : t('theme.darkTitle')}
        >
          {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
      </TooltipContent>
    </Tooltip>
  )
}
