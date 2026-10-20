# Arch AI Studio Bridge (ADR-040): writes `<model>_<scene>_<time>.png` and a matching `.json`
# sidecar into the app's SketchUp inbox:
#
#   ENV['ARCH_STUDIO_DATA_DIR'] (same variable as the app), else
#   Windows: %APPDATA%\com.archaistudio.desktop
#   macOS:   ~/Library/Application Support/com.archaistudio.desktop
#   + /inbox/sketchup
#
# The PNG is rendered into a hidden `.partial` folder and moved into the inbox only when it is
# complete, so the app never lists a half-written file. Sidecar format (all fields optional):
#   { "version": 1, "model": "...skp", "scene": "Front", "width": 2048, "height": 1152,
#     "capturedAt": "2026-10-20T08:00:00Z" }

require 'sketchup.rb'
require 'json'
require 'fileutils'

module ArchStudio
  module Bridge
    APP_ID = 'com.archaistudio.desktop'.freeze
    # Long edge of the exported image; the viewport's aspect ratio is kept.
    LONG_EDGE = 2048

    def self.data_dir
      custom = ENV['ARCH_STUDIO_DATA_DIR']
      return custom unless custom.nil? || custom.strip.empty?

      if Sketchup.platform == :platform_osx
        File.join(Dir.home, 'Library', 'Application Support', APP_ID)
      else
        File.join(ENV['APPDATA'] || File.join(Dir.home, 'AppData', 'Roaming'), APP_ID)
      end
    end

    def self.inbox_dir
      File.join(data_dir, 'inbox', 'sketchup')
    end

    # File-name safe: letters, digits, `-` and `_` only (accents become `_`), at most 48 chars.
    def self.safe(text, fallback)
      cleaned = text.to_s.gsub(/[^0-9A-Za-z_-]+/, '_').gsub(/_+/, '_').gsub(/\A_|_\z/, '')
      cleaned = fallback if cleaned.empty?
      cleaned[0, 48]
    end

    def self.export_size(view)
      width = view.vpwidth.to_f
      height = view.vpheight.to_f
      scale = LONG_EDGE / [width, height].max
      [(width * scale).round, (height * scale).round]
    end

    # Renders the active view; returns the PNG path in the inbox, or nil on failure.
    def self.send_view(scene_name = nil)
      model = Sketchup.active_model
      view = model.active_view
      scene = scene_name || model.pages.selected_page&.name || 'View'
      model_name = model.path.to_s.empty? ? 'untitled' : File.basename(model.path, '.skp')
      stamp = Time.now.strftime('%Y%m%d-%H%M%S-%L')
      base = "#{safe(model_name, 'model')}_#{safe(scene, 'view')}_#{stamp}"

      inbox = inbox_dir
      partial = File.join(inbox, '.partial')
      FileUtils.mkdir_p(partial)
      width, height = export_size(view)
      temp_png = File.join(partial, "#{base}.png")
      ok = view.write_image(filename: temp_png, width: width, height: height,
                            antialias: true, transparent: false)
      return nil unless ok && File.file?(temp_png)

      sidecar = {
        'version' => 1,
        'model' => model.path.to_s,
        'scene' => scene,
        'width' => width,
        'height' => height,
        'capturedAt' => Time.now.utc.strftime('%Y-%m-%dT%H:%M:%SZ')
      }
      File.write(File.join(inbox, "#{base}.json"), JSON.generate(sidecar))
      final_png = File.join(inbox, "#{base}.png")
      File.rename(temp_png, final_png)
      final_png
    rescue StandardError => e
      UI.messagebox("Arch AI Studio: could not send the view.\n#{e.message}")
      nil
    end

    def self.send_current_view
      path = send_view
      return unless path

      Sketchup.status_text = "Arch AI Studio: sent #{File.basename(path)}"
    end

    # One image per scene, in scene order. Scene transitions are switched off while exporting
    # so each image shows the finished camera, then restored.
    def self.send_all_scenes
      model = Sketchup.active_model
      pages = model.pages
      return send_current_view if pages.size.zero?

      options = model.options['PageOptions']
      transitions = options['ShowTransition']
      options['ShowTransition'] = false
      original = pages.selected_page
      sent = 0
      pages.each do |page|
        pages.selected_page = page
        model.active_view.refresh
        sent += 1 if send_view(page.name)
      end
      pages.selected_page = original if original
      options['ShowTransition'] = transitions
      UI.messagebox("Arch AI Studio: sent #{sent} of #{pages.size} scenes to\n#{inbox_dir}")
    end

    def self.open_inbox
      FileUtils.mkdir_p(inbox_dir)
      UI.openURL("file:///#{inbox_dir.tr('\\', '/')}")
    end

    unless file_loaded?(__FILE__)
      menu = UI.menu('Extensions').add_submenu('Arch AI Studio')
      menu.add_item('Gửi view hiện tại (Send current view)') { send_current_view }
      menu.add_item('Gửi tất cả scene (Send all scenes)') { send_all_scenes }
      menu.add_separator
      menu.add_item('Mở thư mục chờ (Open inbox folder)') { open_inbox }
      file_loaded(__FILE__)
    end
  end
end
