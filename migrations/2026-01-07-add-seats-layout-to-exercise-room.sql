-- Add seats_layout column to exercise_room for Prisma ExerciseRoom.seatsLayout

ALTER TABLE `exercise_room`
  ADD COLUMN `seats_layout` LONGTEXT NULL AFTER `places_not_available`;