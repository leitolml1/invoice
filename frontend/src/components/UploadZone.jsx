import { useI18n } from '../i18n.jsx'

export default function UploadZone({ onFileSelected, disabled }) {
  const { t } = useI18n()

  function handleFiles(fileList) {
    const file = fileList?.[0]
    if (file) onFileSelected(file)
  }

  return (
    <section className="upload-wrap">
      <label
        className={`dropzone${disabled ? ' dropzone--disabled' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
        }}
        onDrop={(event) => {
          event.preventDefault()
          if (!disabled) handleFiles(event.dataTransfer.files)
        }}
      >
        <input
          type="file"
          accept="image/*,application/pdf"
          disabled={disabled}
          onChange={(event) => {
            handleFiles(event.target.files)
            event.target.value = ''
          }}
        />
        <div className="dropzone__icon" aria-hidden="true">
          ↑
        </div>
        <p className="dropzone__title">{t.uploadTitle}</p>
        <p className="dropzone__hint">{t.uploadHint}</p>
        <p className="dropzone__meta">{t.uploadMeta}</p>
      </label>
    </section>
  )
}
