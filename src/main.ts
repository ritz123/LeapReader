import "./polyfills";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { bootstrapReader } from "./reader/bootstrap";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

bootstrapReader();
