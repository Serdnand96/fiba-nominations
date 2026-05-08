import { useLanguage } from '../i18n/LanguageContext'

const TEMPLATES = [
  {
    key: 'WCQ',
    file: 'WCQ_TEMPLATE_fixed.docx',
    typeKey: 'nomination',
    signatory: 'Carlos Alves, Executive Director FIBA Americas',
  },
  {
    key: 'BCLA',
    file: 'BCL_Americas_VGO_Final4.docx',
    typeKey: 'confirmation',
    signatory: 'Gino Rullo, Head of Operations, Basketball Champions League Americas',
  },
  {
    key: 'LSB',
    file: 'LSB_2024_VGO_Nomination.docx',
    typeKey: 'confirmation',
    signatory: 'Gino Rullo, Head of Operations, Club Competitions – FIBA Americas',
  },
  {
    key: 'GENERIC',
    file: 'GENERIC_TEMPLATE.docx',
    typeKey: 'nomination',
    signatory: 'Carlos Alves, Executive Director FIBA Americas',
  },
]

const BADGE_COLORS = {
  WCQ: 'bg-red-500/20 text-red-400',
  BCLA: 'bg-blue-500/20 text-blue-400',
  LSB: 'bg-amber-500/20 text-amber-400',
  GENERIC: 'bg-fiba-surface text-fiba-muted',
}

export default function Templates() {
  const { t } = useLanguage()

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">{t('templates.title')}</h2>
      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="fiba-table">
          <thead>
            <tr>
              <th>{t('templates.template')}</th>
              <th>{t('templates.file')}</th>
              <th>{t('templates.type')}</th>
              <th>{t('templates.signatory')}</th>
            </tr>
          </thead>
          <tbody>
            {TEMPLATES.map(tmpl => (
              <tr key={tmpl.key}>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${BADGE_COLORS[tmpl.key]}`}>
                    {tmpl.key}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{tmpl.file}</td>
                <td className="px-4 py-3">{t(`templates.${tmpl.typeKey}`)}</td>
                <td className="px-4 py-3 text-xs">{tmpl.signatory}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
