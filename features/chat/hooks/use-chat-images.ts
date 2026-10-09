import { useCallback, useRef, useState } from "react";

import * as ImagePicker from "expo-image-picker";
import Toast from "react-native-toast-message";

import {
  MAX_UPLOAD_IMAGE_BYTES,
  getImageValidationError,
  prepareUploadImage,
} from "@/features/media/prepare-image";

import {
  MAX_CHAT_IMAGES_PER_SEND,
  splitChatImageBatch,
} from "../chat-rules";

/** Everything a trip to the picker can refuse, kept apart by reason. */
interface StagingRejections {
  overLimit: number;
  unsupportedType: number;
  tooLarge: number;
  unreadable: number;
}

interface ChatImages {
  images: ImagePicker.ImagePickerAsset[];

  /** Free slots left, and what the picker is allowed to return. */
  remaining: number;

  takePhoto: () => Promise<void>;
  pickFromGallery: () => Promise<void>;

  remove: (index: number) => void;
  clear: () => void;
}

const CAMERA_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  allowsEditing: true,
  aspect: [4, 3],
  quality: 0.8,
};

/** The per-file ceiling as the driver reads it. One number, one owner. */
const MAX_IMAGE_MEGABYTES = MAX_UPLOAD_IMAGE_BYTES / (1024 * 1024);

/** Portuguese counts read badly when the verb is not agreed. */
function count(amount: number, singular: string, plural: string): string {
  return `${amount} ${amount === 1 ? singular : plural}`;
}

/**
 * The images staged in the composer, from the picker to the send.
 *
 * Preparation stays inside this hook for the same reason it lives inside
 * `useImageCapture`: `prepareUploadImage` re-encoding the file is the ONLY
 * thing that strips EXIF now that the API does not touch the bytes, and a
 * path that skipped it would ship the driver's GPS coordinates to the bucket.
 *
 * Nothing is ever dropped quietly. A trip that refuses images says how many
 * and why, per reason — the limit, the format and the size are three
 * different problems and a driver can only fix the one they are told about.
 */
function useChatImages(): ChatImages {
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);

  // Read inside async callbacks that started before the last render.
  const imagesRef = useRef<ImagePicker.ImagePickerAsset[]>([]);

  const commit = useCallback((next: ImagePicker.ImagePickerAsset[]) => {
    imagesRef.current = next;
    setImages(next);
  }, []);

  const report = useCallback(
    (accepted: number, rejections: StagingRejections) => {
      const { overLimit, unsupportedType, tooLarge, unreadable } = rejections;
      const refused = overLimit + unsupportedType + tooLarge + unreadable;

      if (refused === 0) return;

      const reasons: string[] = [];

      if (accepted > 0) {
        reasons.push(`${count(accepted, "foto entrou", "fotos entraram")}.`);
      }

      if (overLimit > 0) {
        reasons.push(
          `${count(overLimit, "ficou", "ficaram")} de fora: o limite é ${MAX_CHAT_IMAGES_PER_SEND} por envio.`,
        );
      }

      if (unsupportedType > 0) {
        reasons.push(
          `${count(unsupportedType, "está", "estão")} em formato não aceito (JPEG, PNG ou WebP).`,
        );
      }

      if (tooLarge > 0) {
        reasons.push(
          `${count(tooLarge, "passa", "passam")} de ${MAX_IMAGE_MEGABYTES} MB.`,
        );
      }

      if (unreadable > 0) {
        reasons.push(
          `Não foi possível preparar ${count(unreadable, "foto", "fotos")}.`,
        );
      }

      // One toast, several sentences, rather than one toast per reason: the
      // toast host shows a single message at a time, so firing three in a row
      // would hide the first two — which is exactly the silent discard this
      // is here to prevent.
      Toast.show({
        type: "error",
        text1:
          accepted > 0
            ? "Nem todas as fotos entraram"
            : "Nenhuma foto foi anexada",
        text2: reasons.join(" "),
        position: "top",
        visibilityTime: 5000,
      });
    },
    [],
  );

  /**
   * Turns what the picker returned into staged images.
   *
   * The two gates run at different moments on purpose. The declared type is
   * checked BEFORE transcoding, so a file that will be refused anyway never
   * costs a slot or a re-encode; the size is checked AFTER, because the byte
   * count that matters is the one signed into the upload authorisation, not
   * the one the gallery reported.
   */
  const stage = useCallback(
    async (picked: ImagePicker.ImagePickerAsset[]) => {
      const staged = imagesRef.current;

      const { accepted, overLimit, unsupportedType } = splitChatImageBatch(
        picked,
        staged.length,
      );

      const prepared: ImagePicker.ImagePickerAsset[] = [];

      let tooLarge = 0;
      let unreadable = 0;

      for (const asset of accepted) {
        try {
          const ready = await prepareUploadImage(asset);

          if (getImageValidationError(ready)) {
            tooLarge += 1;
            continue;
          }

          prepared.push(ready);
        } catch {
          unreadable += 1;
        }
      }

      if (prepared.length > 0) {
        commit([...imagesRef.current, ...prepared]);
      }

      report(prepared.length, {
        overLimit,
        unsupportedType,
        tooLarge,
        unreadable,
      });
    },
    [commit, report],
  );

  // Only the camera asks. The gallery is the system photo picker, which needs
  // no permission; asking for the media library on Android 12 or older would
  // be refused outright, since the manifest no longer declares
  // READ_EXTERNAL_STORAGE (app.config.js).
  const ensureCameraPermission = useCallback(async (): Promise<boolean> => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (permission.granted) return true;

    Toast.show({
      type: "error",
      text1: "Permissão necessária",
      text2: "É necessário permitir acesso à câmera.",
      position: "top",
    });

    return false;
  }, []);

  const remaining = Math.max(0, MAX_CHAT_IMAGES_PER_SEND - images.length);

  const warnFull = useCallback(() => {
    Toast.show({
      type: "error",
      text1: "Limite de fotos atingido",
      text2: `O envio aceita no máximo ${MAX_CHAT_IMAGES_PER_SEND} fotos.`,
      position: "top",
    });
  }, []);

  const takePhoto = useCallback(async () => {
    if (remaining === 0) {
      warnFull();
      return;
    }

    if (!(await ensureCameraPermission())) return;

    const result = await ImagePicker.launchCameraAsync(CAMERA_OPTIONS);
    if (result.canceled || !result.assets[0]) return;

    await stage([result.assets[0]]);
  }, [remaining, warnFull, ensureCameraPermission, stage]);

  const pickFromGallery = useCallback(async () => {
    if (remaining === 0) {
      warnFull();
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      // `allowsEditing` is mutually exclusive with multiple selection, so the
      // crop step is the price of picking more than one at a time.
      allowsMultipleSelection: true,
      // A hint, not a guarantee: not every Android picker honours it, which
      // is why the batch rule counts the overflow again on the way in.
      selectionLimit: remaining,
      quality: 0.8,
    });

    if (result.canceled || result.assets.length === 0) return;

    await stage(result.assets);
  }, [remaining, warnFull, stage]);

  const remove = useCallback(
    (index: number) => {
      commit(imagesRef.current.filter((_unused, position) => position !== index));
    },
    [commit],
  );

  const clear = useCallback(() => commit([]), [commit]);

  return {
    images,
    remaining,
    takePhoto,
    pickFromGallery,
    remove,
    clear,
  };
}

export { useChatImages };
export type { ChatImages };
