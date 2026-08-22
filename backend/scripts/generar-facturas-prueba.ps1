# Genera facturas de prueba renderizadas (PNG) para validar el pipeline de OCR.
# OJO: son sinteticas. Sirven para probar el pipeline, NO reemplazan facturas
# reales escaneadas/fotografiadas.
#
# Uso:  powershell -ExecutionPolicy Bypass -File scripts/generar-facturas-prueba.ps1

Add-Type -AssemblyName System.Drawing

$destino = Join-Path $PSScriptRoot '..\test-assets'
if (-not (Test-Path $destino)) { New-Item -ItemType Directory -Path $destino | Out-Null }
$destino = (Resolve-Path $destino).Path

function New-Invoice {
    param(
        [string]$Ruta,
        [string]$Proveedor,
        [string]$IdFiscal,
        [string]$Numero,
        [string]$Fecha,
        [string]$Oc,
        [array]$Items,
        [string]$Subtotal,
        [string]$Impuestos,
        [string]$Total,
        [double]$Rotacion = 0,
        [int]$Ruido = 0,
        [double]$Contraste = 1.0,
        [switch]$TacharTotal
    )

    $w = 1000; $h = 1150
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear([System.Drawing.Color]::White)

    $negro = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(20, 20, 20))
    $gris = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 90, 90))
    $lapiz = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 60, 60), 1)

    $fTitulo = New-Object System.Drawing.Font('Arial', 26, [System.Drawing.FontStyle]::Bold)
    $fSub = New-Object System.Drawing.Font('Arial', 13, [System.Drawing.FontStyle]::Bold)
    $fTexto = New-Object System.Drawing.Font('Arial', 13)
    $fMono = New-Object System.Drawing.Font('Consolas', 14)
    $fMonoB = New-Object System.Drawing.Font('Consolas', 15, [System.Drawing.FontStyle]::Bold)

    $y = 45
    $g.DrawString($Proveedor, $fTitulo, $negro, 55, $y); $y += 46
    $g.DrawString("CUIT: $IdFiscal", $fTexto, $gris, 57, $y); $y += 28
    $g.DrawString('Av. Siempreviva 1234 - Buenos Aires - Argentina', $fTexto, $gris, 57, $y); $y += 48

    $g.DrawString('FACTURA', $fSub, $negro, 57, $y)
    $g.DrawString("Nro: $Numero", $fTexto, $negro, 300, $y)
    $g.DrawString("Fecha: $Fecha", $fTexto, $negro, 620, $y); $y += 30
    $g.DrawString("Orden de compra: $Oc", $fTexto, $negro, 57, $y); $y += 20
    $g.DrawString('Moneda: USD', $fTexto, $negro, 57, $y); $y += 40

    $g.DrawLine($lapiz, 55, $y, 945, $y); $y += 14
    $g.DrawString('CODIGO', $fSub, $negro, 60, $y)
    $g.DrawString('DESCRIPCION', $fSub, $negro, 185, $y)
    $g.DrawString('CANT', $fSub, $negro, 590, $y)
    $g.DrawString('P.UNIT', $fSub, $negro, 690, $y)
    $g.DrawString('IMPORTE', $fSub, $negro, 830, $y)
    $y += 28
    $g.DrawLine($lapiz, 55, $y, 945, $y); $y += 16

    foreach ($it in $Items) {
        $g.DrawString($it.codigo, $fMono, $negro, 60, $y)
        $g.DrawString($it.descripcion, $fMono, $negro, 185, $y)
        $g.DrawString($it.cantidad, $fMono, $negro, 600, $y)
        $g.DrawString($it.precio, $fMono, $negro, 690, $y)
        $g.DrawString($it.importe, $fMono, $negro, 830, $y)
        $y += 34
    }

    $y += 12
    $g.DrawLine($lapiz, 600, $y, 945, $y); $y += 16
    $g.DrawString('Subtotal:', $fMono, $negro, 620, $y)
    $g.DrawString($Subtotal, $fMono, $negro, 830, $y); $y += 30
    $g.DrawString('IVA 21%:', $fMono, $negro, 620, $y)
    $g.DrawString($Impuestos, $fMono, $negro, 830, $y); $y += 34
    $g.DrawString('TOTAL:', $fMonoB, $negro, 620, $y)
    $g.DrawString($Total, $fMonoB, $negro, 830, $y)
    $totalY = $y
    $y += 60

    $g.DrawString('Condiciones de pago: 30 dias fecha factura.', $fTexto, $gris, 57, $y); $y += 26
    $g.DrawString('Documento generado electronicamente.', $fTexto, $gris, 57, $y)

    # Tapa el total con una mancha, para forzar needs_review.
    if ($TacharTotal) {
        $mancha = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(160, 130, 130, 130))
        $g.FillEllipse($mancha, 815, ($totalY - 6), 135, 40)
        $mancha.Dispose()
    }

    $g.Dispose()

    # Post-proceso: rotacion, contraste y ruido para simular escaneo.
    $final = $bmp
    if ($Rotacion -ne 0) {
        $rot = New-Object System.Drawing.Bitmap($w, $h)
        $g2 = [System.Drawing.Graphics]::FromImage($rot)
        $g2.Clear([System.Drawing.Color]::White)
        $g2.TranslateTransform($w / 2, $h / 2)
        $g2.RotateTransform($Rotacion)
        $g2.TranslateTransform(-$w / 2, -$h / 2)
        $g2.DrawImage($bmp, 0, 0)
        $g2.Dispose()
        $final = $rot
    }

    if ($Ruido -gt 0 -or $Contraste -ne 1.0) {
        $rnd = New-Object System.Random(1234)
        for ($py = 0; $py -lt $final.Height; $py += 1) {
            for ($px = 0; $px -lt $final.Width; $px += 1) {
                $c = $final.GetPixel($px, $py)
                $v = $c.R
                if ($Contraste -ne 1.0) {
                    $v = [int](128 + ($v - 128) * $Contraste)
                }
                if ($Ruido -gt 0) {
                    $v = $v + $rnd.Next(-$Ruido, $Ruido)
                }
                if ($v -lt 0) { $v = 0 }
                if ($v -gt 255) { $v = 255 }
                $final.SetPixel($px, $py, [System.Drawing.Color]::FromArgb($v, $v, $v))
            }
        }
    }

    $final.Save($Ruta, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "generada: $Ruta  ($($final.Width)x$($final.Height))"
    if ($final -ne $bmp) { $final.Dispose() }
    $bmp.Dispose()
}

$items = @(
    @{ codigo = 'SKU-100'; descripcion = 'Cable UTP Cat6 305m'; cantidad = '12'; precio = '85.50'; importe = '1026.00' },
    @{ codigo = 'SKU-200'; descripcion = 'Switch 24 puertos Gigabit'; cantidad = '2'; precio = '210.00'; importe = '420.00' },
    @{ codigo = 'SKU-300'; descripcion = 'Patch panel 24 bocas'; cantidad = '4'; precio = '49.00'; importe = '196.00' }
)

# 1) Limpia, nitida. Caso ideal.
New-Invoice -Ruta (Join-Path $destino 'factura-01-limpia.png') `
    -Proveedor 'Distribuidora del Sur S.A.' -IdFiscal '30-71234567-9' `
    -Numero 'A-0001-00099' -Fecha '18/07/2026' -Oc 'PO-2026-0001' `
    -Items $items -Subtotal '1642.00' -Impuestos '344.82' -Total '1986.82'

# 2) Escaneo torcido con ruido y grises. Caso realista de celular.
New-Invoice -Ruta (Join-Path $destino 'factura-02-escaneada.png') `
    -Proveedor 'Distribuidora del Sur S.A.' -IdFiscal '30-71234567-9' `
    -Numero 'A-0001-00099' -Fecha '18/07/2026' -Oc 'PO-2026-0001' `
    -Items $items -Subtotal '1642.00' -Impuestos '344.82' -Total '1986.82' `
    -Rotacion 1.8 -Ruido 26

# 3) Bajo contraste + total tapado. Debe salir needs_review en el total.
New-Invoice -Ruta (Join-Path $destino 'factura-03-degradada.png') `
    -Proveedor 'Distribuidora del Sur S.A.' -IdFiscal '30-71234567-9' `
    -Numero 'A-0001-00099' -Fecha '18/07/2026' -Oc 'PO-2026-0001' `
    -Items $items -Subtotal '1642.00' -Impuestos '344.82' -Total '1986.82' `
    -Rotacion -1.2 -Ruido 14 -Contraste 0.42 -TacharTotal

Write-Host ''
Write-Host "Listo. Archivos en: $destino"
