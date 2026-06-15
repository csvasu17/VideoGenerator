Add-Type -AssemblyName System.Speech
$text  = [System.IO.File]::ReadAllText('D:/Vasu/Accelerator/Rheem Video/out/localhost/voice-segments/scene-1-sapi-text.txt', [Text.Encoding]::UTF8)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft David Desktop')
$synth.Rate   = 2
$synth.Volume = 100
$synth.SetOutputToWaveFile('D:/Vasu/Accelerator/Rheem Video/out/localhost/voice-segments/scene-1-sapi.wav')
$synth.Speak($text)
$synth.Dispose()