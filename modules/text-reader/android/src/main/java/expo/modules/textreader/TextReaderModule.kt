package expo.modules.textreader

import android.net.Uri
import android.os.SystemClock
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Offline text reading of a photo the app already prepared (decision 14.2).
 *
 * Deliberately tiny: it only transcribes. What the text MEANS (is the invoice
 * number there, is the typed km there) is decided in TypeScript, in
 * features/ai-precheck, where it is unit-tested. Nothing read leaves the phone.
 */
class TextReaderModule : Module() {
  // Created on first use and reused: creating it loads the bundled model.
  private var recognizer: TextRecognizer? = null

  // Decoding the JPEG and mapping the result stay off the UI thread.
  private val executor: ExecutorService = Executors.newSingleThreadExecutor()

  private fun recognizer(): TextRecognizer =
    recognizer ?: TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).also {
      recognizer = it
    }

  override fun definition() = ModuleDefinition {
    Name("TextReader")

    AsyncFunction("readText") { uri: String, promise: Promise ->
      val context = appContext.reactContext

      if (context == null) {
        promise.reject(CodedException("ERR_TEXT_READER_CONTEXT", "No Android context", null))
        return@AsyncFunction
      }

      executor.execute {
        val startedAt = SystemClock.elapsedRealtime()

        try {
          val image = InputImage.fromFilePath(context, Uri.parse(uri))

          recognizer()
            .process(image)
            .addOnSuccessListener(executor) { text ->
              promise.resolve(
                mapOf(
                  "durationMs" to (SystemClock.elapsedRealtime() - startedAt).toInt(),
                  "blocks" to text.textBlocks.map { block ->
                    mapOf(
                      "text" to block.text,
                      "lines" to block.lines.map { line ->
                        mapOf("text" to line.text, "confidence" to line.confidence.toDouble())
                      },
                    )
                  },
                ),
              )
            }
            .addOnFailureListener(executor) { error ->
              promise.reject(CodedException("ERR_TEXT_READER_FAILED", error.message, error))
            }
        } catch (error: Exception) {
          // An unreadable or vanished file: the check gives up, the flow goes on.
          promise.reject(CodedException("ERR_TEXT_READER_IMAGE", error.message, error))
        }
      }
    }

    OnDestroy {
      recognizer?.close()
      recognizer = null
      executor.shutdown()
    }
  }
}
