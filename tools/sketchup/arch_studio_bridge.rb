# Arch AI Studio Bridge — SketchUp extension loader (ADR-040).
#
# Sends the current view (or every scene) to the Arch AI Studio inbox folder as a PNG plus a
# small JSON sidecar. The desktop app lists the views under Generate → "Receive from
# SketchUp"; nothing is uploaded anywhere and no AI model runs from SketchUp.

require 'sketchup.rb'
require 'extensions.rb'

module ArchStudio
  module Bridge
    EXTENSION = SketchupExtension.new('Arch AI Studio Bridge', 'arch_studio_bridge/main')
    EXTENSION.version = '1.0.0'
    EXTENSION.creator = 'Arch AI Studio'
    EXTENSION.description = 'Send SketchUp views to the Arch AI Studio inbox ' \
                            '(Extensions > Arch AI Studio).'
    Sketchup.register_extension(EXTENSION, true)
  end
end
