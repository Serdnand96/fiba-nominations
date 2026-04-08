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
  WCQ: 'bg-red-100 text-red-700',
  BCLA: 'bg-blue-100 text-blue-700',
  LSB: 'bg-amber-100 text-amber-700',
  GENERIC: 'bg-gray-100 text-gray-700',
}

export default function Templates() {
  const { t } = useLanguage()

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">{t('templates.title')}</h2>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{t('templates.template')}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{t('templates.file')}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{t('templates.type')}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{t('templates.signatory')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {TEMPLATES.map(tmpl => (
              <tr key={tmpl.key} className="hover:bg-gray-50">
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
  )
}
