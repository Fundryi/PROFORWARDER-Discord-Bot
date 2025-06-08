const { logInfo, logError } = require('../../utils/logger');

/**
 * Telegram Media Handler - Media processing and validation
 * Handles media type detection, validation, and URL filtering
 */
class TelegramMediaHandler {
  constructor() {
    // Supported media extensions
    this.imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    this.videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv'];
  }

  /**
   * Check if file is an image
   */
  isImageFile(filename) {
    if (!filename) return false;
    return this.imageExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  }

  /**
   * Check if file is a video
   */
  isVideoFile(filename) {
    if (!filename) return false;
    return this.videoExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  }

  /**
   * Process Discord attachments into Telegram media format
   */
  processAttachments(attachments) {
    const media = [];
    
    if (!attachments || attachments.size === 0) {
      return media;
    }

    for (const attachment of attachments.values()) {
      if (this.isImageFile(attachment.name)) {
        media.push({
          type: 'photo',
          media: attachment.url
        });
      } else if (this.isVideoFile(attachment.name)) {
        media.push({
          type: 'video',
          media: attachment.url
        });
      }
      // Non-media files are handled separately in the converter
    }

    return media;
  }

  /**
   * Process Discord embed media into Telegram format
   */
  processEmbedMedia(embeds) {
    const media = [];
    
    if (!embeds || embeds.length === 0) {
      return media;
    }

    for (const embed of embeds) {
      // Handle embed images
      if (embed.image && embed.image.url) {
        media.push({
          type: 'photo',
          media: embed.image.url
        });
      }
      
      // Handle embed thumbnails
      if (embed.thumbnail && embed.thumbnail.url) {
        media.push({
          type: 'photo',
          media: embed.thumbnail.url
        });
      }
    }

    return media;
  }

  /**
   * Check if media contains embed-sourced URLs that might cause issues
   */
  hasEmbedMedia(media) {
    if (!media || media.length === 0) {
      return false;
    }

    return media.some(item =>
      item.media && (
        item.media.includes('cdn-telegram.org') ||
        item.media.includes('discordapp.net') ||
        item.media.includes('images-ext-')
      )
    );
  }

  /**
   * Filter out invalid or problematic media URLs
   */
  filterValidMedia(media) {
    if (!media || media.length === 0) {
      return [];
    }

    const validMedia = media.filter(item => {
      // Check for empty or invalid items
      if (!item || !item.media || !item.media.trim()) {
        return false;
      }
      
      // Filter out Discord proxy URLs which can't be accessed by Telegram
      if (item.media.includes('images-ext-1.discordapp.net') ||
          item.media.includes('images-ext-2.discordapp.net') ||
          item.media.includes('cdn.discordapp.com/embed/') ||
          item.media.includes('media.discordapp.net/external/')) {
        return false;
      }
      
      return true;
    });

    return validMedia;
  }

  /**
   * Determine media sending strategy based on media characteristics
   */
  determineMediaStrategy(media, caption = '') {
    const envConfig = require('../../config/env');
    const isDebugMode = envConfig.debugMode;
    
    // No media - text only
    if (!media || media.length === 0) {
      return 'text-only';
    }

    // Check for embed media that might cause issues
    const hasEmbedMedia = this.hasEmbedMedia(media);
    if (hasEmbedMedia) {
      if (isDebugMode) {
        logInfo('📎 MEDIA STRATEGY: Detected embed media, treating as text-only to avoid issues');
      }
      return 'text-only'; // Treat as text-only to prevent WEBPAGE_MEDIA_EMPTY
    }

    // Filter to valid media only
    const validMedia = this.filterValidMedia(media);
    if (validMedia.length === 0) {
      if (isDebugMode) {
        logInfo('📎 MEDIA STRATEGY: No valid media URLs, treating as text-only');
      }
      return 'text-only';
    }

    // Check caption length limits
    const captionLengthLimit = envConfig.telegram?.captionLengthLimit || 900;
    const splitStrategy = envConfig.telegram?.captionSplitStrategy || 'smart';
    
    if (caption.length <= captionLengthLimit) {
      return 'media-with-caption'; // Simple media + caption
    }

    // Long caption - determine split strategy
    if (splitStrategy === 'separate' && !hasEmbedMedia) {
      return 'separate'; // Send media separately, then text
    }

    return 'smart-split'; // Smart caption splitting
  }

  /**
   * Prepare media for sending based on count and type
   */
  prepareMediaForSending(media, caption = '', method = 'media-with-caption') {
    const validMedia = this.filterValidMedia(media);
    
    if (validMedia.length === 0) {
      return null;
    }

    if (validMedia.length === 1) {
      // Single media item
      const mediaItem = validMedia[0];
      return {
        isSingle: true,
        method: this.getAPIMethod(mediaItem.type),
        mediaItem: mediaItem,
        payload: this.buildSingleMediaPayload(mediaItem, caption)
      };
    } else {
      // Multiple media items - media group
      return {
        isSingle: false,
        method: 'sendMediaGroup',
        mediaItems: validMedia,
        payload: this.buildMediaGroupPayload(validMedia, caption)
      };
    }
  }

  /**
   * Get appropriate API method for media type
   */
  getAPIMethod(mediaType) {
    switch (mediaType) {
      case 'photo':
        return 'sendPhoto';
      case 'video':
        return 'sendVideo';
      default:
        return 'sendDocument';
    }
  }

  /**
   * Build payload for single media item
   */
  buildSingleMediaPayload(mediaItem, caption = '') {
    const payload = {};
    
    // Set media parameter based on type
    if (mediaItem.type === 'photo') {
      payload.photo = mediaItem.media;
    } else if (mediaItem.type === 'video') {
      payload.video = mediaItem.media;
    } else {
      payload.document = mediaItem.media;
    }

    // Add caption if provided
    if (caption.trim()) {
      payload.caption = caption;
      payload.parse_mode = 'MarkdownV2';
    }

    return payload;
  }

  /**
   * Build payload for media group
   */
  buildMediaGroupPayload(mediaItems, caption = '') {
    const mediaWithCaption = mediaItems.map((item, index) => ({
      ...item,
      caption: index === 0 && caption.trim() ? caption : undefined,
      parse_mode: index === 0 && caption.trim() ? 'MarkdownV2' : undefined
    }));

    return {
      media: JSON.stringify(mediaWithCaption)
    };
  }

  /**
   * Extract non-media attachments for text inclusion
   */
  extractNonMediaAttachments(attachments) {
    const nonMediaFiles = [];
    
    if (!attachments || attachments.size === 0) {
      return nonMediaFiles;
    }

    for (const attachment of attachments.values()) {
      if (!this.isImageFile(attachment.name) && !this.isVideoFile(attachment.name)) {
        nonMediaFiles.push({
          name: attachment.name,
          url: attachment.url
        });
      }
    }

    return nonMediaFiles;
  }
}

module.exports = TelegramMediaHandler;