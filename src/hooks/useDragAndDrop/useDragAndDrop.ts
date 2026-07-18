import {
  PointerSensor,
  useSensor,
  useSensors,
  KeyboardSensor,
  TouchSensor,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useDragState } from './useDragState';
import { useHandleDragEnd } from './useDragEnd';

export function useDragAndDrop() {
  const dragState = useDragState();
  const {
    activeItem,
    linkDropPlaceholder,
    setActiveItem,
    setCollectionDropPlaceholder,
    setLinkDropPlaceholder,
  } = dragState;
  const handleDragEnd = useHandleDragEnd({
    activeItem,
    linkDropPlaceholder,
    setActiveItem,
    setCollectionDropPlaceholder,
    setLinkDropPlaceholder,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  return {
    sensors,
    ...dragState,
    handleDragEnd,
  };
}
