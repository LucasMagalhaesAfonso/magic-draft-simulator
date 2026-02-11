$prompt = @"
eu vou sair entao te dou autorizacao e permissao para tudo... implementa o que der dessas melhorias
"@

$prompt | claude > "$PSScriptRoot\claude_output.txt" 2> "$PSScriptRoot\claude_error.txt"
