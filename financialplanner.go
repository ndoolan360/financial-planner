package financialplanner

import (
	"embed"
)

//go:embed index.html
//go:embed src
//go:embed styles
var FS embed.FS
