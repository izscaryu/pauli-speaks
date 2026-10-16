# Generates test/fixtures/vad-speech.wav for test/vad.test.js: a built-in Windows voice
# (System.Speech, no real person's recording) saying "Testing one two three", with
# 1 s of silence before and 1.5 s after. 16 kHz, 16-bit, mono PCM.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-vad-fixture.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$rate = 16000
$out = Join-Path $PSScriptRoot '..\test\fixtures\vad-speech.wav'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'en-US' } | Select-Object -First 1
  if ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    $rate, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $speech = New-Object System.IO.MemoryStream
  $synth.SetOutputToAudioStream($speech, $format) # raw PCM, no header
  $synth.Speak('Testing one two three')
  $synth.SetOutputToNull()
} finally {
  $synth.Dispose()
}

$pcm = $speech.ToArray()
$before = New-Object byte[] ($rate * 2)            # 1 s of 16-bit silence
$after = New-Object byte[] ([int]($rate * 2 * 1.5)) # 1.5 s
$dataSize = $before.Length + $pcm.Length + $after.Length

$file = [System.IO.File]::Create($out)
$w = New-Object System.IO.BinaryWriter($file)
try {
  $ascii = [System.Text.Encoding]::ASCII
  $w.Write($ascii.GetBytes('RIFF')); $w.Write([uint32](36 + $dataSize)); $w.Write($ascii.GetBytes('WAVE'))
  $w.Write($ascii.GetBytes('fmt ')); $w.Write([uint32]16)
  $w.Write([uint16]1); $w.Write([uint16]1)                 # PCM, mono
  $w.Write([uint32]$rate); $w.Write([uint32]($rate * 2))   # sample rate, byte rate
  $w.Write([uint16]2); $w.Write([uint16]16)                # block align, bits per sample
  $w.Write($ascii.GetBytes('data')); $w.Write([uint32]$dataSize)
  $w.Write($before); $w.Write($pcm); $w.Write($after)
} finally {
  $w.Dispose()
}

$seconds = [math]::Round($dataSize / ($rate * 2), 2)
$speechSeconds = [math]::Round($pcm.Length / ($rate * 2), 2)
Write-Output "Wrote $out ($seconds s, speech part $speechSeconds s, $($dataSize + 44) bytes)"
