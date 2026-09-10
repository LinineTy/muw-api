// @muw-owned
package main

import (
	_ "embed"

	"github.com/QuantumNous/new-api/controller"
)

//go:embed CHANGELOG.md
var changelogMarkdown string

// init 把内置的 CHANGELOG.md 交给 controller。
// 镜像里不带 .md 文件（.dockerignore 排除），运行期读盘不可行，只能编译期嵌入；
// 注入口放在 main 包是因为 embed 只能引用本包目录下的文件。
func init() {
	controller.SetChangelogContent(changelogMarkdown)
}
