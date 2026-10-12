#!/usr/bin/env bash
# TACG — сборка мини-сервиса движка агента в однофайловые исполняемые файлы
# (ADR-017). Bun кросс-компилирует с любой платформы: никакого тулчейна целевой
# ОС не нужно. Артефакты: mini-services/tacg-agent/dist/tacg-agent-<target>.
#
#   bash scripts/build-executables.sh              # все таргеты
#   bash scripts/build-executables.sh windows-x64  # один таргет
#
# Таргеты: windows-x64 · windows-arm64 · darwin-x64 · darwin-arm64 · linux-x64 · linux-arm64
# Каждый бинарник ~60–95 МБ: внутрь вшиты рантайм Bun, socket.io и адаптеры LLM.
# При запуске бинарник создаёт рядом с собой папку data/ (runs.json, кэш прайсов,
# llm-config.json) — переносится копированием одного файла + при желанием data/.
set -euo pipefail

cd "$(dirname "$0")/../mini-services/tacg-agent"
mkdir -p dist

TARGETS=("${@:-windows-x64 darwin-x64 darwin-arm64 linux-x64}")

for t in "${TARGETS[@]}"; do
  case "$t" in
    windows-*) out="dist/tacg-agent-${t}.exe" ;;
    *) out="dist/tacg-agent-${t}" ;;
  esac
  echo "── собираю bun-${t} → ${out}"
  bun build index.ts --compile --target="bun-${t}" --outfile "$out"
done

echo
echo "Готово: $(ls -lh dist | tail -n +2 | awk '{print $9, "("$5")"}' | tr '\n' ' ')"
echo
echo "Фронтенд (Next.js) рядом — двумя файлами:"
echo "  1) bun run build  →  .next/standalone (сервер) — запускается: bun .next/standalone/server.js"
echo "  2) Caddy/прокси на :3003 для socket.io (см. ADR-017: путь к «одному файлу совсем» — статический экспорт)"
