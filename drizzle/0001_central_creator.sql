CREATE TABLE IF NOT EXISTS `media` (
  `restaurant_id` text NOT NULL,
  `id` text NOT NULL,
  `type` text NOT NULL,
  `data` blob NOT NULL,
  PRIMARY KEY (`restaurant_id`, `id`)
);

CREATE INDEX IF NOT EXISTS `media_restaurant_idx` ON `media` (`restaurant_id`);
