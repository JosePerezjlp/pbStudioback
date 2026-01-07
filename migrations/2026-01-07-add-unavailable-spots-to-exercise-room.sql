-- Add unavailable_spots column to exercise_room for Prisma ExerciseRoom.unavailableSpots

ALTER TABLE `exercise_room`
  ADD COLUMN `unavailable_spots` INT NOT NULL DEFAULT 0 AFTER `seats_layout`;