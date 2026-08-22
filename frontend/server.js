import cors from 'cors'
import express from 'express'
import multer from 'multer'

const PORT = 3001
const app = express()
const upload = multer({ storage: multer.memoryStorage() })

app.use(cors({ origin: true }))

/**
 * Stub de desarrollo: mismo contrato que el pipeline A+B.
 * Reemplazar el cuerpo por la llamada real cuando Persona A/B esté lista.
 */
const SAMPLE = {
  factura: {
    proveedor: 'Papelería Andina S.A.',
    fecha: '2026-08-15',
    items: [
      {
        nombre: 'Resma A4 80g',
        cantidad: 10,
        precio_unitario: 4500,
        total: 45000,
      },
      {
        nombre: 'Toner HP 85A',
        cantidad: 2,
        precio_unitario: 32000,
        total: 64000,
      },
    ],
    total_factura: 109000,
    needs_review: true,
  },
  discrepancias: [
    {
      tipo: 'precio',
      campo: 'precio_unitario',
      valor_factura: '32000',
      valor_ordenado: '28500',
      explicacion_legible:
        'El toner se facturó a 32000 pero la orden de compra indica 28500 por unidad.',
      severidad: 'alta',
      requiere_revision_manual: true,
    },
    {
      tipo: 'cantidad',
      campo: 'cantidad',
      valor_factura: '10',
      valor_ordenado: '8',
      explicacion_legible:
        'La factura incluye 10 resmas; la orden de compra autoriza 8.',
      severidad: 'media',
      requiere_revision_manual: false,
    },
    {
      tipo: 'fecha',
      campo: 'fecha',
      valor_factura: '2026-08-15',
      valor_ordenado: '2026-08-14',
      explicacion_legible:
        'La fecha de la factura difiere en un día de la fecha de la orden.',
      severidad: 'baja',
      requiere_revision_manual: false,
    },
  ],
}

app.post('/reconcile', upload.single('factura'), async (req, res) => {
  if (!req.file) {
    res.status(400).send('Falta el archivo de factura (campo "factura").')
    return
  }

  // Simula latencia de inferencia local para el estado de carga del frontend.
  await new Promise((resolve) => setTimeout(resolve, 1800))
  res.json(SAMPLE)
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`INVOICE API en http://127.0.0.1:${PORT}`)
})
